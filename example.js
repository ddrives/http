var http = require('http')
var path = require('path')
var memdb = require('memdb')
var ddrive = require('@ddrive/core')
var raf = require('@dwcore/ref')
var ddriveHttp = require('.')

var drive = ddrive(memdb())
var vault = drive.createVault({
  file: function (name) {
    return raf(path.join(__dirname, name))
  }
})
var onrequest = ddriveHttp(vault)
var server = http.createServer()

vault.append('readme.md')
vault.append('package.json')
vault.append('index.js')

server.listen(8000)
server.on('request', onrequest)

console.info('Now listening on localhost:8000')
console.info('Visit in your browser to see metadata')
