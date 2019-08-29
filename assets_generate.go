// +build ignore

package main

import (
	"log"

	"github.com/shurcooL/vfsgen"

	"github.com/oxplot/runsheet/data"
)

func main() {
	err := vfsgen.Generate(data.StaticAssets, vfsgen.Options{
		Filename:     "data/prod_static.go",
		PackageName:  "data",
		BuildTags:    "prod",
		VariableName: "StaticAssets",
	})
	if err != nil {
		log.Fatalln(err)
	}
}
