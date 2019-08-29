package runsheet

import (
	"testing"
)

func TestSchedule(t *testing.T) {
	t1 := &Task{Id: "t1", Assignee: "a", Duration: 2}
	t2 := &Task{Id: "t2", Assignee: "a", Duration: 1}
	t3 := &Task{Id: "t3", Assignee: "a", Duration: 1}
	t4 := &Task{Id: "t4", Assignee: "b", Duration: 2}
	t1.Dependers = []*Task{t2, t3, t4}
	t2.Dependers = []*Task{t3}
	t4.Dependers = []*Task{t3}
	tasks := []*Task{t1, t2, t3, t4}
	ScheduleTasks(tasks)

	if t1.StartsAt != 0 {
		t.Fail()
	}
	if t2.StartsAt != 2 {
		t.Fail()
	}
	if t3.StartsAt != 4 {
		t.Fail()
	}
	if t4.StartsAt != 2 {
		t.Fail()
	}
}
