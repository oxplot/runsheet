Vue.use(VueMarkdown);

Vue.mixin({
  methods: {
    humanTime: function(minutes) {
      var hours = String(Math.floor(minutes / 60));
      minutes = String(minutes % 60);
      if (minutes.length === 1)
        minutes = '0' + minutes;
      return `${hours}:${minutes}`;
    },
    humanDuration: function(minutes) {
      var ret = [];
      var hours = Math.floor(minutes / 60);
      minutes = minutes % 60;
      if (minutes > 0) ret.push(`${minutes}m`);
      if (hours > 0) ret.push(`${hours}h`);
      return ret.join(' ');
    },
    labelForTime: function(d) {
      return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    },
    tooltipForTime: function(d) {
      return d.toLocaleString();
    },
  },
});

Vue.component('home-page', {
  data: function() {
    return {
      data: {
        sheets: null,
        error: null,
      },
      destroyed: null,
    };
  },
  metaInfo: {
    title: "Runsheet V2",
  },
  methods: {
    loadData: function() {
      return fetch('/sheets').then(function(res) {
        if (!res.ok) {
          this.data.error = "failed to contact the server";
          return;
        }
        return res.json();
      }.bind(this)).then(function(d) {
        this.data = d;
      }.bind(this)).catch(function() {
        this.data.error = "failed to contact the server";
      }.bind(this));
    }
  },
  mounted: function() {
    const cb = function() {
      this.loadData().then(function() {
        if (!this.destroyed) {
          setTimeout(cb, 1000);
        }
      }.bind(this));
    }.bind(this);
    cb();
  },
  beforeDestroy: function() {
    this.destroyed = true;
  },
  template: `
    <v-app>
      <v-toolbar app color="primary">
      <v-toolbar-title class="white--text">Runsheet v2</v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn title="Guide" :to="{name: 'guide'}" icon flat color="white"><v-icon>help</v-icon></v-btn>
      </v-toolbar>
      <v-content>
        <v-alert v-if="data.error" :value="data.error" type="error">
          {{data.error}}
        </v-alert>
        <v-container v-else fluid grid-list-md>
          <v-layout row wrap>

          <v-flex v-for="sheet in data.sheets" :key="sheet.id" xs12 sm6 md4 lg3>
          <sheet-card :sheet="sheet"></sheet-card>
          </v-flex>

          </v-layout>
        </v-container>
      </v-content>
    </v-app>
  `,
});

Vue.component('sheet-card', {
  props: ['sheet'],
  computed: {
    hasId: function() {
      return Boolean(this.sheet.id);
    },
    href: function() {
      return `/sheet/${this.sheet.id}`;
    },
  },
  template: `
    <v-card>
      <v-card-title><div class="title">
        <id-or-name :id="sheet.id" :name="sheet.name"></id-or-name>
      </div></v-card-title>
      <v-card-text><vue-markdown :source="sheet.description || ''"></vue-markdown></v-card-text>
    <v-card-actions>
    <v-spacer></v-spacer>
    <v-btn :to="{name: 'sheet', params: {sheet_id:sheet.id}}" flat color="primary">
      Open<v-icon right>arrow_forward</v-icon>
    </v-btn>
    </v-card-actions>
    </v-card>`,
});

Vue.component('sheet-page', {
  data: function() {
    return {
      sheet: {
        tasks: [],
        error: '',
      },
      taskDetails: {
        task: null,
        show: false,
        x: 0,
        y: 0,
      },
      statusHolds: {},
      showDetails: false,
      now: null,
    };
  },
  metaInfo: function() {
    return {
      title: this.sheet.name || this.sheet.id,
    };
  },
  watch: {
    '$route.params.task_id': {
      immediate: true,
      handler: function(newVal, oldVal) {
      },
    },
  },
  computed: {
    tasksMap: function() {
      return this.sheet.tasks.reduce((ts, t)=>Object.assign({[t.id]:t}, ts), {});
    },
    taskReady: function() {
      var tasks = this.tasksMap;
      var ret = {};
      this.sheet.tasks.map(function(t) {
        ret[t.id] = t.dependees.every((d)=>tasks[d].status === 'done');
      });
      return ret;
    },
    assignees: function() {
      return Array.from(new Set(this.sheet.tasks.map((i)=>i.assignee))).sort(function(a, b){
        return a.toLowerCase().localeCompare(b.toLowerCase());
      }).map((v, i)=>({[v]:i})).reduce((v, c)=>Object.assign(v, c), {});
    },
    assigneesStyle: function() {
      return {
        height: '100%',
        width: '100%',
        display: 'grid',
        gridTemplateColumns: `4em repeat(${Object.keys(this.assignees).length}, 1fr)`,
        gridAutoRows: 'minmax(3em, auto)',
        gridGap: '5px',
      };
    },
    behindSchedule: function() {
      return this.sheet.tasks.filter((t)=>t.status !== 'done').map(function(t){
        var d = new Date(this.sheet.startTime);
        d.setMinutes(d.getMinutes() + t.startsAt + t.duration);
        return {task: t, endTime: d};
      }.bind(this)).some(function(i){
        return i.endTime <= this.now;
      }.bind(this));
    },
  },
  methods: {
    updateTaskStatus: function(t, newStatus) {
      t.status = newStatus;
      this.statusHolds[t.id] = {
        status: newStatus,
        until: new Date().getTime() + 2000,
      };
      fetch(`/sheet/${this.$route.params.sheet_id}/task/${t.id}`, {
        method: 'POST',
        body: `status=${newStatus}`,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      }).catch((e)=>console.log(e));
    },
    showTaskDetails: function(t, e) {
      this.taskDetails.task = null;
      this.taskDetails.show = false;
      this.$nextTick(function() {
        this.taskDetails.task = t;
        this.taskDetails.show = true;
        if (e) {
          this.taskDetails.x = e.clientX;
          this.taskDetails.y = e.clientY;
        }
      }.bind(this));
    },
    prepareSheet: function(sheet) {
      if (!sheet.startTime) {
        sheet.startTime = new Date('9999-01-01 00:00:00');
      } else if (isNaN(new Date(sheet.startTime).getTime())) {
        sheet.error = 'Invalid start time';
        return;
      }

      sheet.tasks.map(function(t){
        t.startTime = new Date(sheet.startTime);
        t.endTime = new Date(sheet.startTime);
        t.startTime.setMinutes(t.startTime.getMinutes() + t.startsAt);
        t.endTime.setMinutes(t.endTime.getMinutes() + t.startsAt + t.duration);
      }.bind(this));

      sheet.totalDuration = Math.max(0, ...sheet.tasks.map((i)=>i.startsAt + i.duration));
      var validTimeDivisions = [1, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360];
      sheet.timeDivivion = validTimeDivisions[validTimeDivisions.length - 1];
      for (const td of validTimeDivisions) {
        if (sheet.totalDuration / td < 60) {
          sheet.timeDivision = td;
          break;
        }
      }
    },
    loadData: function() {
      if (this.destroyed) {
        return Promise.resolve(null);
      }
      return fetch('/sheet/' + this.$route.params.sheet_id + '/tasks').then(function(res) {
        if (!res.ok) {
          this.data.error = "failed to contact the server";
          return;
        }
        return res.json();
      }.bind(this)).then(function(d) {
        this.prepareSheet(d);
        this.sheet = d;
        if (this.taskDetails.task) {
          var ts = this.sheet.tasks.filter((t)=>t.id === this.taskDetails.task.id);
          this.taskDetails.task = ts[0];
        }
        this.sheet.tasks.map(function(t) {
          var hold = this.statusHolds[t.id];
          if (hold) {
            if (new Date().getTime() > hold.until) {
              delete this.statusHolds[t.id];
              return;
            }
            t.status = hold.status;
          }
        }.bind(this));
      }.bind(this)).catch(function() {
        this.sheet.error = "failed to contact the server";
      }.bind(this));
    }
  },
  mounted: function() {
    this.now = new Date();
    this.tickCb = setInterval(function() {
      this.now = new Date();
    }.bind(this), 1000);

    const cb = function() {
      this.loadData().then(function() {
        if (this.destroyed) {
          return;
        }
        setTimeout(cb, 1000);
      }.bind(this));
    }.bind(this);
    cb();
  },
  beforeDestroy: function() {
    clearInterval(this.tickCb);
    this.destroyed = true;
  },
  template: `
    <v-app @click.native="taskDetails.show = false">
      <v-toolbar app extended dense color="primary">
      <v-btn @click="$router.push({name: 'home'})" flat icon color="white">
        <v-icon>home</v-icon>
      </v-btn>
      <v-toolbar-title class="white--text">
        <v-layout flex>
          <v-flex>
            <id-or-name :id="sheet.id" :name="sheet.name"></id-or-name>
          </v-flex>
          <v-chip disabled v-if="behindSchedule" class="ml-3" small color="error" text-color="white">
            <v-icon left>error</v-icon> Behind schedule
          </v-chip>
        </v-layout>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn title="Guide" :to="{name: 'guide'}" icon flat color="white"><v-icon>help</v-icon></v-btn>
      <div slot="extension" :style="assigneesStyle" class="px-3 body-2 white--text">
        <div style="display:flex; align-items:center">
          <v-icon color="white" style="margin:auto">access_time</v-icon>
        </div>
        <div v-for="(i, a) in assignees" style="display:flex; align-items:center;">
          <span style="margin: auto">{{a}}</span>
        </div>
      </div>
      </v-toolbar>
      <v-content>
        <v-alert v-if="sheet.error" :value="sheet.error" type="error">
          {{sheet.error}}
        </v-alert>
        <v-container v-else fluid>
          <sheet v-if="sheet.tasks.length > 0" @showTaskDetails="showTaskDetails" :taskReady="taskReady" :sheet="sheet"></sheet>

      <v-menu
        v-model="taskDetails.show"
        :close-on-click="false"
        :close-on-content-click="false"
        :close-delay="0"
        absolute
        :position-x="taskDetails.x"
        :position-y="taskDetails.y"
        full-width
      >
        <v-card v-if="taskDetails.task">
          <v-card-title><div class="title">
            <id-or-name :id="taskDetails.task.id" :name="taskDetails.task.name"></id-or-name>
          </div></v-card-title>
          <v-card-text>
            <vue-markdown :source="taskDetails.task.description || ''"></vue-markdown>
            <span class="caption full-op-on-hover" style="opacity: 0.7">
              <span class="grey--text text--darken-1">ID:</span> {{taskDetails.task.id}}
              <span class="ml-3" title="Start and end times">
                <span class="grey--text text--darken-1">
                  <v-icon small>access_time</v-icon>
                </span>
                  <span :title="tooltipForTime(taskDetails.task.startTime)">{{labelForTime(taskDetails.task.startTime)}}</span>
                  -
                  <span :title="tooltipForTime(taskDetails.task.endTime)">{{labelForTime(taskDetails.task.endTime)}}</span>
              </span>
              <span class="ml-3" title="Duration">
                <span class="grey--text text--darken-1">
                  <v-icon small>update</v-icon>
                </span> {{humanDuration(taskDetails.task.duration)}}
              </span>
            </span>
          </v-card-text>
          <v-divider v-if="showDetails"></v-divider>
          <v-card-text v-if="showDetails">
            <div class="grey--text text--darken-1">Depends on:</div>
            <div v-for="taskId in taskDetails.task.dependees">
              <v-icon small>{{tasksMap[taskId].status == 'done' ? 'check_box' : 'check_box_outline_blank'}}</v-icon>
              <id-or-name style="cursor:pointer" @click.native="showTaskDetails(tasksMap[taskId])" class="markdown-inline-p markdown-slim-p" :id="taskId" :name="tasksMap[taskId].name">
              </id-or-name>
            </div>
            <div class="mt-2 grey--text text--darken-1">Required by:</div>
            <div v-for="taskId in taskDetails.task.dependers">
              <v-icon small>{{tasksMap[taskId].status == 'done' ? 'check_box' : 'check_box_outline_blank'}}</v-icon>
              <id-or-name style="cursor:pointer" @click.native="showTaskDetails(tasksMap[taskId])" class="markdown-inline-p markdown-slim-p" :id="taskId" :name="tasksMap[taskId].name">
              </id-or-name>
            </div>
          </v-card-text>
          <v-divider></v-divider>
          <v-card-actions>
            <v-btn @click="taskDetails.show = false" icon flat color="secondary" title="Close">
              <v-icon>close</v-icon>
            </v-btn>
            <v-btn @click="showDetails = !showDetails" icon flat color="secondary" :title="(showDetails ? 'Hide' : 'Show') + ' details'">
              <v-icon>{{showDetails ? 'expand_less' : 'expand_more'}}</v-icon>
            </v-btn>

            <v-spacer></v-spacer>

            <v-chip v-if="taskDetails.task.status === 'idle' && taskReady[taskDetails.task.id] !== true" disabled color="grey lighten-2" small title="Some dependees are not done yet">Not ready</v-chip>
            <v-chip v-else-if="taskDetails.task.status === 'idle' && taskReady[taskDetails.task.id] === true" disabled color="green" text-color="white" small>Ready</v-chip>
            <v-chip v-else-if="taskDetails.task.status === 'ongoing'" disabled color="amber darken-1" text-color="white" small>Ongoing</v-chip>
            <v-chip v-else-if="taskDetails.task.status === 'done'" disabled color="grey lighten-2" small>Done</v-chip>

            <v-btn v-if="taskDetails.task.status === 'idle' && taskReady[taskDetails.task.id] === true" @click="updateTaskStatus(taskDetails.task, 'ongoing')" icon flat color="primary" title="Start">
              <v-icon>play_arrow</v-icon>
            </v-btn>
            <v-btn v-else-if="taskDetails.task.status === 'ongoing'" @click="updateTaskStatus(taskDetails.task, 'done')" icon flat color="primary" title="Finish">
              <v-icon>done</v-icon>
            </v-btn>
            <v-btn v-else-if="taskDetails.task.status === 'done'" @click="updateTaskStatus(taskDetails.task, 'idle')" icon flat color="primary" title="Reset">
              <v-icon>replay</v-icon>
            </v-btn>

          </v-card-actions>
        </v-card>
      </v-menu>

        </v-container>
      </v-content>
    </v-app>
  `,
});

Vue.component('id-or-name', {
  props: ['id', 'name'],
  data: function() {
    return {
    };
  },
  template: `
    <span>
      <vue-markdown class="markdown-slim-p" v-if="name" :source="name"></vue-markdown>
      <span v-else>{{id}}</span>
    </span>
  `
});

Vue.component('time-cell', {
  props: ['startEndTime', 'now', 'pos', 'span'],
  computed: {
    style: function() {
      return {
        border: '5px solid transprent',
        position: 'relative',
        overflow: 'visible',
        verticalAlign: 'top',
        width: "4em",
      };
    },
    labelStyle: function() {
      return {
        textAlign: 'right',
        lineHeight: '1em',
        position: 'relative',
        top: 'calc(-0.5em - 3px)',
      };
    },
    nowLabelStyle: function() {
      return {
        fontWeight: this.current ? 'bold' : '',
      };
    },
    lineStyle: function() {
      return {
        opacity: '0.6',
        position: 'absolute',
        top: '-3px',
        left: '100%',
        width: '10000px',
      };
    },
    nowLineStyle: function() {
      return {
        position: 'absolute',
        top: 'calc(1em - 3px)',
        left: '100%',
        width: '10000px',
      };
    },
    current: function() {
      return this.now >= this.startEndTime.start && this.now < this.startEndTime.end;
    },
  },
  methods: {
  },
  template: `
    <td :rowspan="span" :style="style">
      <v-divider :style="lineStyle"></v-divider>
      <v-divider v-if="current" :class="current ? 'error' : ''" :style="nowLineStyle"></v-divider>
      <div class="caption pr-3" :style="labelStyle">
        <div :title="tooltipForTime(startEndTime.start)" >{{labelForTime(startEndTime.start)}}</div>
        <div v-if="current" :style="nowLabelStyle" :title="tooltipForTime(now)" class="mt-1 error--text">{{labelForTime(now)}}</div>
      </div>
    </td>
  `,
});

Vue.component('task-cell', {
  props: ['task', 'column', 'ready', 'span'],
  data: function() {
    return {
    };
  },
  computed: {
    style: function() {
      return {
        wordWrap: 'break-word',
        transition: 'background-color 0.5s, border-color 0.5s',
        verticalAlign: 'top',
        position: 'relative',
        zIndex: "1",
        borderRadius: '5px',
        border: `1px solid ${this.task.status === 'idle' && !this.ready ? '#eee' : 'transparent'} !important`,
      };
    },
    backgroundColor: function() {
      if (this.task.status === 'idle') {
        return this.ready ? 'green lighten-3' : 'white';
      } else {
        return {
          ongoing: 'amber lighten-2',
          done: 'grey lighten-2',
        }[this.task.status];
      }
    },
    titleStyle: function() {
      return {
        color: this.task.status === 'done' ? 'rgba(0,0,0,0.4)' : '',
        opacity: this.task.status === 'done' ? 0.5 : 1,
        textDecoration: this.task.status === 'done' ? 'line-through' : '',
        fontStyle: this.task.status === 'done' ? 'italic' : '',
      };
    },
  },
  template: `
    <td :class="backgroundColor + ' pa-3'" :style="style" :rowspan="span">
      <div :style="titleStyle">
        <id-or-name :id="task.id" :name="task.name" class="text--primary"></id-or-name>
      </div>
    </td>
  `,
});

Vue.component('sheet', {
  props: ['sheet', 'taskReady'],
  data: function() {
    return {
      tickCb: null,
      currentTime: null,
    };
  },
  computed: {
    tableRows: function() {
      var totalDuration = this.sheet.totalDuration;
      var timeTasks = [...Array(Math.ceil(totalDuration / this.sheet.timeDivision)).keys()];
      for (var i = 0; i < timeTasks.length; i++) {
        timeTasks[i] = {
          timeLabel: true,
          assignee: '',
          startsAt: i * this.sheet.timeDivision,
          duration: this.sheet.timeDivision,
        };
      }
      timeTasks.push(...this.sheet.tasks);
      return this.tablizeTasks(timeTasks);
    },
    tableStyle: function() {
      return {
        tableLayout: 'fixed',
        borderSpacing: '6px',
        width: '100%',
        border: '0',
      };
    },
  },
  mounted: function() {
    this.currentTime = new Date();
    this.tickCb = setInterval(function() {
      this.currentTime = new Date();
    }.bind(this), 1000);
  },
  beforeDestroy: function() {
    clearInterval(this.tickCb);
  },
  methods: {
    tablizeTasks: function(tasks) {
      var END = '\0';
      var assignees = tasks.reduce((obj, t)=>Object.assign(obj, {[t.assignee]: null}), {})
      var rows = [];
      var offsets = Object.keys(assignees).reduce((obj, a)=>Object.assign(obj, {[`${a},0`]: END}), {});
      offsets = tasks.reduce((obj, t)=>Object.assign(obj, {
        [`${t.assignee},${t.startsAt + t.duration}`]: END,
      }), offsets);
      offsets = tasks.reduce((obj, t)=>Object.assign(obj, {
        [`${t.assignee},${t.startsAt}`]: t,
      }), offsets);
      var spans = [...new Set(Object.keys(offsets).map((o)=>Number(o.split(',')[1])))];
      spans.sort((a,b)=>a < b ? -1 : 1);
      spans = spans.filter((s, i)=>i>0).map((s, i)=>s - spans[i]);
      var assigneesSorted = Object.keys(assignees);
      assigneesSorted.sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
      var off = 0;
      spans.map(function(span) {
        var row = [];
        assigneesSorted.map(function(assignee) {
          var atoff = offsets[`${assignee},${off}`];
          if (atoff === undefined) {
            assignees[assignee]['span'] += 1;
          } else {
            var newcol;
            if (atoff === END) {
              newcol = {span: 1};
            } else {
              newcol = {span: 1, task: atoff};
            }
            assignees[assignee] = newcol;
            row.push(newcol);
          }
        });
        rows.push(row);
        off += span;
      });
      return rows;
    },
    startEndTimeFor: function(task) {
      var start = new Date(this.sheet.startTime);
      var end = new Date(this.sheet.startTime);
      start.setMinutes(start.getMinutes() + task.startsAt);
      end.setMinutes(end.getMinutes() + task.startsAt + task.duration);
      return {start, end};
    },
  },
  template: `
    <table :style="tableStyle">
      <tr v-for="row in tableRows">
        <template v-for="col in row">
          <time-cell v-if="col.task && col.task.timeLabel" :span="col.span"
            :startEndTime="startEndTimeFor(col.task)" :now="currentTime"></time-cell>
          <task-cell v-if="col.task && !col.task.timeLabel" :span="col.span" @click.native="$emit('showTaskDetails', col.task, $event)" :ready="taskReady[col.task.id]" :task="col.task"></task-cell>
          <td v-if="!col.task" :rowspan="col.span">&nbsp;</td>
        </template>
      </tr>
    </table>
  `,
});

Vue.component('guide-page', {
  data: function() {
    return {
      content: '',
    };
  },
  metaInfo: {
    title: "Guide",
  },
  mounted: function() {
    fetch('/static/guide.md').then(function(res) {
      if (res.ok) {
        return res.text();
      }
    }.bind(this)).then(function(d) {
      this.content = d;
    }.bind(this)).catch(function() {
    }.bind(this));
  },
  template: `
    <v-app>
      <v-toolbar app color="primary" dark>
        <v-toolbar-side-icon @click.native="$router.push({name: 'home'})"><v-icon>home</v-icon></v-toolbar-side-icon>
        <v-toolbar-title>Runsheet V2 Guide</v-toolbar-title>
        <v-spacer></v-spacer>
      </v-toolbar>
      <v-content>
        <v-container>
          <vue-markdown :breaks="false" :source="content"></vue-markdown>
        </v-container>
      </v-content>
    </v-app>
  `,
});

var vueApp = new Vue({
  el: "#app",
  router: new VueRouter({
    mode: 'history',
    routes: [
      {
        path: "/",
        name: "home",
        component: Vue.component('home-page'),
      },
      {
        path: "/guide",
        name: "guide",
        component: Vue.component('guide-page'),
      },
      {
        path: "/sheet/:sheet_id",
        name: "sheet",
        component: Vue.component('sheet-page'),
        children: [
          {
            path: "task/:task_id",
            name: "task"
          }
        ],
      },
    ],
  }),
});
