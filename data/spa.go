package data

var SpaHtml = []byte(`<!doctype html>
<html>
<head>
<link href='https://fonts.googleapis.com/css?family=Roboto:300,400,500,700|Material+Icons' rel="stylesheet">
<link href="/static/vuetify.min.css" rel="stylesheet">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, minimal-ui">
</head>
<link href="/static/main.css" rel="stylesheet">
<body>

<div id="app" v-cloak><router-view></router-view></div>

<script src="/static/vue.js"></script>
<script src="/static/vue-router.js"></script>
<script src="/static/vue-meta.js"></script>
<script src="/static/vue-markdown.js"></script>
<script src="/static/vuetify.js"></script>
<script src="/static/main.js"></script>

</body>
</html>`)
