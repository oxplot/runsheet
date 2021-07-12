//go:generate go run assets_generate.go

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/denisenkom/go-mssqldb"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/godror/godror"
	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"

	"github.com/gorilla/mux"
	"github.com/jmoiron/sqlx"

	"github.com/oxplot/runsheet/data"
	"github.com/oxplot/runsheet/runsheet"
)

const (
	DefaultQueryTimeout   = 3000 // in milliseconds
	MaxConnectionLifetime = time.Second * 15
)

type Config struct {
	Listen        string
	QueryTimeout  int // in milliseconds
	ConnectionURL string
	RunsheetsSQL  string
}

type Runsheet struct {
	Id            string           `db:"id" json:"id"`
	Name          *string          `db:"name" json:"name"`
	Description   *string          `db:"description" json:"description"`
	ConnectionUrl string           `db:"connection_url" json:"-"`
	TasksSql      string           `db:"tasks_sql" json:"-"`
	UpdateSql     string           `db:"update_sql" json:"-"`
	StartTime     *string          `db:"start_time" json:"startTime"`
	QueryTimeout  *uint            `db:"query_timeout" json:"-"`
	Tasks         []*runsheet.Task `db:"-" json:"-"`
	Json          []byte           `db:"-" json:"-"`
	Err           string           `db:"-" json:"error"`
}

var (
	runsheets = struct {
		Lock          sync.Mutex
		Sheets        map[string]*Runsheet
		Json          []byte
		Err           error
		StatusUpdates map[string]map[string]runsheet.TaskStatus
	}{
		Sheets:        make(map[string]*Runsheet),
		Json:          []byte("{}"),
		StatusUpdates: make(map[string]map[string]runsheet.TaskStatus),
	}

	configPath = flag.String("config", "", "path to config file - by default, config is loaded from various paths")
	config     = Config{
		Listen:       ":8080",
		QueryTimeout: DefaultQueryTimeout,
	}

	connections = struct {
		mu    sync.Mutex
		Conns map[string]*sqlx.DB
	}{
		Conns: make(map[string]*sqlx.DB),
	}
)

func getConnFor(connUrl string) (*sqlx.DB, error) {
	connections.mu.Lock()
	defer connections.mu.Unlock()
	conn := connections.Conns[connUrl]
	if conn != nil {
		return conn, nil
	}
	parts := strings.SplitN(connUrl, "://", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("connection url '%s' must be of form driver://...", connUrl)
	}
	conn, err := sqlx.Open(parts[0], parts[1])
	if err != nil {
		return nil, err
	}
	conn.SetConnMaxLifetime(MaxConnectionLifetime)
	connections.Conns[connUrl] = conn
	return conn, nil
}

func getSheetJson(sheet *Runsheet) ([]byte, error) {
	type TaskWithDeps struct {
		*runsheet.Task
		Dependees []string `json:"dependees"`
		Dependers []string `json:"dependers"`
	}
	tasksWithDeps := make([]TaskWithDeps, 0, len(sheet.Tasks))
	dependees := runsheet.DependeesFor(sheet.Tasks)
	for _, t := range sheet.Tasks {
		twd := TaskWithDeps{Task: t}
		for _, d := range t.Dependers {
			twd.Dependers = append(twd.Dependers, d.Id)
		}
		if twd.Dependers == nil {
			twd.Dependers = make([]string, 0) // so we get [] instead of null
		}
		sort.Slice(twd.Dependers, func(i, j int) bool {
			return twd.Dependers[i] < twd.Dependers[j]
		})
		for _, d := range dependees[t] {
			twd.Dependees = append(twd.Dependees, d.Id)
		}
		if twd.Dependees == nil {
			twd.Dependees = make([]string, 0) // so we get [] instead of null
		}
		sort.Slice(twd.Dependees, func(i, j int) bool {
			return twd.Dependees[i] < twd.Dependees[j]
		})
		tasksWithDeps = append(tasksWithDeps, twd)
	}

	json, err := json.Marshal(struct {
		*Runsheet
		Tasks []TaskWithDeps `json:"tasks"`
	}{sheet, tasksWithDeps})
	if err != nil {
		return nil, err
	}
	return json, nil
}

func loadRunsheets() (map[string]*Runsheet, error) {
	rows := []*Runsheet{}
	if err := func() error {
		conn, err := getConnFor(config.ConnectionURL)
		if err != nil {
			return err
		}
		ctx, _ := context.WithTimeout(context.Background(), time.Millisecond*time.Duration(config.QueryTimeout))
		if err := conn.SelectContext(ctx, &rows, config.RunsheetsSQL); err != nil {
			return err
		}
		return nil
	}(); err != nil {
		return nil, err
	}

	sheetIdMap := make(map[string]bool)
	for _, r := range rows {
		if r.Id == "" {
			return nil, fmt.Errorf("runsheet id cannot be blank")
		}
		if sheetIdMap[r.Id] {
			return nil, fmt.Errorf("runsheet id '%s' must be unique", r.Id)
		}
		sheetIdMap[r.Id] = true
	}

	sheets := make(map[string]*Runsheet)
	done := make(chan bool)
	for _, r := range rows {
		if r.QueryTimeout == nil {
			r.QueryTimeout = new(uint)
			*r.QueryTimeout = DefaultQueryTimeout
		}
		sheets[r.Id] = r

		go func(r *Runsheet) {
			defer func() { done <- true }()
			defer func() {
				json, err := getSheetJson(r)
				if err != nil {
					json = []byte("{error: \"fatal JSON encoder error - contact developer\"}")
				}
				r.Json = json
			}()
			conn, err := getConnFor(r.ConnectionUrl)
			if err != nil {
				r.Err = err.Error()
				return
			}
			r.Tasks, err = runsheet.LoadTasks(conn, r.TasksSql, time.Millisecond*time.Duration(*r.QueryTimeout))
			if err != nil {
				r.Err = err.Error()
				return
			}
			if err := runsheet.ValidateTasks(r.Tasks); err != nil {
				r.Err = err.Error()
				return
			}
			runsheet.ScheduleTasks(r.Tasks)
		}(r)

	}
	for range rows {
		<-done
	}
	return sheets, nil
}

func processUpdates() {
	runsheets.Lock.Lock()
	sheets := runsheets.Sheets
	updates := runsheets.StatusUpdates
	runsheets.StatusUpdates = make(map[string]map[string]runsheet.TaskStatus)
	runsheets.Lock.Unlock()

	for sheetId, taskStatuses := range updates {
		sheet := sheets[sheetId]
		if sheet == nil {
			continue
		}
		func(sheet *Runsheet) {
			conn, err := getConnFor(sheet.ConnectionUrl)
			if err != nil {
				return
			}
			for taskId, status := range taskStatuses {
				sql := strings.Replace(sheet.UpdateSql, "{{status}}", string(status), -1)
				sql = strings.Replace(sql, "{{task}}", taskId, -1)
				ctx, _ := context.WithTimeout(context.Background(), time.Millisecond*time.Duration(*sheet.QueryTimeout))
				if _, err = conn.ExecContext(ctx, sql); err != nil {
					log.Print(err)
				}
			}
		}(sheet)
	}
}

func updateRunsheets() {
	var sheetsMap map[string]*Runsheet
	sheetsMap, err := loadRunsheets()
	var sheets []*Runsheet
	if err == nil {
		sheets = make([]*Runsheet, 0, len(sheetsMap))
		for _, r := range sheetsMap {
			sheets = append(sheets, r)
		}
		sort.Slice(sheets, func(i, j int) bool {
			return sheets[i].Id < sheets[j].Id
		})
	}
	var errStr string
	if err != nil {
		errStr = err.Error()
	}
	json, err := json.Marshal(struct {
		Sheets []*Runsheet `json:"sheets"`
		Err    string      `json:"error"`
	}{sheets, errStr})
	if err != nil {
		json = []byte("{error: \"fatal JSON encoder error - contact developer\"}")
	}
	runsheets.Lock.Lock()
	runsheets.Sheets = sheetsMap
	runsheets.Json = json
	runsheets.Lock.Unlock()
}

func runsheetLoop() {
	for {
		processUpdates()
		updateRunsheets()
		time.Sleep(time.Second)
	}
}

func spaHandler(w http.ResponseWriter, r *http.Request) {
	w.Write(data.SpaHtml)
}

func runsheetsHandler(w http.ResponseWriter, r *http.Request) {
	var json []byte
	runsheets.Lock.Lock()
	json = runsheets.Json
	runsheets.Lock.Unlock()
	w.Header().Add("Content-Type", "application/json")
	w.Write(json)
}

func tasksEPHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runsheets.Lock.Lock()
	sheet := runsheets.Sheets[vars["sheet"]]
	runsheets.Lock.Unlock()
	if sheet == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Add("Content-Type", "application/json")
	w.Write(sheet.Json)
}

func taskHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		spaHandler(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	r.ParseForm()
	func() {
		runsheets.Lock.Lock()
		defer runsheets.Lock.Unlock()
		if _, ok := runsheets.Sheets[vars["sheet"]]; !ok {
			return
		}
		ts := runsheets.StatusUpdates[vars["sheet"]]
		if ts == nil {
			ts = make(map[string]runsheet.TaskStatus)
			runsheets.StatusUpdates[vars["sheet"]] = ts
		}
		ts[vars["task"]] = runsheet.TaskStatus(r.Form.Get("status"))
	}()
}

func main() {
	flag.Parse()

	if *configPath == "" {
		log.Fatal("config path must be set with -config")
	}

	cfgBytes, err := ioutil.ReadFile(*configPath)
	if err != nil {
		log.Fatalf("failed reading config - %s", err)
	}

	if err := json.Unmarshal(cfgBytes, &config); err != nil {
		log.Fatalf("failed reading config - %s", err)
	}

	go runsheetLoop()
	router := mux.NewRouter()
	for _, p := range []string{"", "guide", "sheet/{sheet}"} {
		router.HandleFunc("/"+p, spaHandler)
	}
	router.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(data.StaticAssets)))
	router.HandleFunc("/sheets", runsheetsHandler)
	router.HandleFunc("/sheet/{sheet}/tasks", tasksEPHandler)
	router.HandleFunc("/sheet/{sheet}/task/{task}", taskHandler)
	log.Printf("listening on http://%s/", config.Listen)
	panic(http.ListenAndServe(config.Listen, router))
}
