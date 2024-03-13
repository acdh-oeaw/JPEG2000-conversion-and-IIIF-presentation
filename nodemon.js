const nodemon = require('nodemon')

nodemon({
    script: __dirname+"/server.js",
    ext: "js json",
    verbose: "true"
})
