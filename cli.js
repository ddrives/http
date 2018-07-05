#!/usr/bin/env node

var fs = require('fs')
var http = require('http')
var path = require('path')
var ram = require('random-access-memory')
var ddrive = require('@ddrive/core')
var revelation = require('@flockcore/core')
var serve = require('.')

var key = process.argv[2]
var storage = ram
var port = 8080

if (!key) {
  console.log('key or path to a dPack required')
  process.exit(1)
}

try {
  fs.stat(path.join(key, '.dpack'), function (err, stat) {
    if (err) return start()
    storage = path.join(key, '.dpack')
    key = null
    start()
  })
} catch (e) { start() }

function start () {
  var vault = ddrive(storage, key, {sparse: true})
  var server = http.createServer(serve(vault, {live: true}))
  server.listen(port)
  console.log(`Visit http://localhost:${port} to see archive`)

  if (key) {
    vault.ready(function () {
      revelation(vault, {live: true})
    })
  }
}
