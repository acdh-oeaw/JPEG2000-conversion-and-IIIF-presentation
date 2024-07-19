const nodemon = require('nodemon')

nodemon({
    script: __dirname+"/server.mjs",
    ext: "js mjs json",
    verbose: "true"
})
