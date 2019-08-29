package runsheet

import (
	"fmt"
	"math"
	"sort"

	"github.com/looplab/tarjan"
)

type TaskStatus string

const (
	StatusIdle    TaskStatus = "idle"
	StatusOngoing            = "ongoing"
	StatusDone               = "done"
)

type Task struct {
	Id          string     `db:"id" json:"id"`
	Name        *string    `db:"name" json:"name"`
	Description *string    `db:"description" json:"description"`
	Status      TaskStatus `db:"status" json:"status"`
	StartsAt    uint       `db:"-" json:"startsAt"`
	Duration    uint       `db:"duration" json:"duration"`
	Assignee    string     `db:"assignee" json:"assignee"`
	Dependers   []*Task    `db:"-" json:"-"`
}

func DependeesFor(tasks []*Task) map[*Task][]*Task {
	deps := make(map[*Task][]*Task)
	for _, t := range tasks {
		for _, d := range t.Dependers {
			deps[d] = append(deps[d], t)
		}
	}
	return deps
}

func depMaps(tasks []*Task) (dependees map[*Task][]*Task, dependers map[*Task][]*Task) {
	dependees = make(map[*Task][]*Task)
	dependers = make(map[*Task][]*Task)
	for _, t := range tasks {
		for _, d := range t.Dependers {
			dependers[t] = append(dependers[t], d)
			dependees[d] = append(dependees[d], t)
		}
	}
	return
}

func ValidateTasks(tasks []*Task) error {
	// Check for loops
	graph := make(map[interface{}][]interface{})
	for _, t := range tasks {
		for _, d := range t.Dependers {
			graph[t.Id] = append(graph[t.Id], d.Id)
		}
	}
	for _, vs := range tarjan.Connections(graph) {
		if len(vs) > 1 {
			return fmt.Errorf("dependency loop detected")
		}
	}
	return nil
}

func ScheduleTasks(tasks []*Task) {
	tasks = append([]*Task{}, tasks...)
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].Id < tasks[j].Id
	})

	assigneeDuration := make(map[string]uint)
	tasksSet := make(map[*Task]bool, len(tasks))
	dependees, _ := depMaps(tasks)

	for _, t := range tasks {
		tasksSet[t] = true
	}

	for len(tasks) > 0 {
		var pickedTask *Task
		var pickedTaskPos int
		var pickedStart uint
		nextMinStart := uint(math.MaxUint32)
	Outer:
		for i, t := range tasks {
			maxDependeeDuration := uint(0)
			for _, d := range dependees[t] {
				if tasksSet[d] {
					continue Outer
				}
				if d.StartsAt+d.Duration > maxDependeeDuration {
					maxDependeeDuration = d.StartsAt + d.Duration
				}
			}
			start := maxDependeeDuration
			if assigneeDuration[t.Assignee] > start {
				start = assigneeDuration[t.Assignee]
			}
			if start < nextMinStart {
				nextMinStart = start
				pickedTask = t
				pickedStart = start
				pickedTaskPos = i
			}
		}

		pickedTask.StartsAt = pickedStart
		assigneeDuration[pickedTask.Assignee] = pickedTask.Duration + pickedStart

		tasks[pickedTaskPos] = tasks[len(tasks)-1]
		tasks = tasks[:len(tasks)-1]
		delete(tasksSet, pickedTask)
	}
}
