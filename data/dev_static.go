// +build !prod

package data

import (
	"net/http"
)

var StaticAssets = http.Dir("static")
