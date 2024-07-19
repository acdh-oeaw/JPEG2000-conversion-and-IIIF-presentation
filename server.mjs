import restana from 'restana'
import { useCompressionStream } from 'h3-compression'
import connectQuery from 'connect-query'
import cors from 'cors'
import finalhandler from 'finalhandler'
import serveIndex from 'serve-index'
import serveStatic from 'serve-static'
import bodyParser from 'body-parser'
import memcachePlus from 'memcache-plus'
import { fileURLToPath } from 'url' 
import fs from 'fs'
import path from 'path'
import mustache from 'mustache'
import util from 'util'
import md5sum from './md5sum.js'
import indexHelpers from './serve-index-parts.js'
import { imageProcessor, processImageFile, setAfterImageFileProcessing, getImageFilesProcessed, validInFileExts } from './image-processing.js'
import iiif_presentation from './iiif-presentation.js'
import iiif_search from './iiif-search.js'

const service = restana({onBeforeResponse: useCompressionStream})
let requestHost = 'https://localhost:3000'

serveStatic.mime.define({
  'text/plain': ['md5']
})
service.use(bodyParser.urlencoded({ extended: false }))
service.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type'],
  maxAge: 300,
  optionsSuccessStatus: 200
}))
service.options('*', cors())
const memcacheClient = new memcachePlus({
  hosts: (process.env.MEMCACHED_SERVERS||"").split(','),
  disabled: process.env.MEMCACHED_SERVERS === undefined,
  onNetError: err => 
    process.env.MEMCACHED_SERVERS !== undefined ? console.error(`Error connecting to memcached:
${err.toString()}`) || true : true
})
const md5sumValidate = util.promisify(md5sum.validate)

service.use(cors());
iiif_presentation(service)
service.use(connectQuery());
iiif_search(service)

function updateMD5Checksums(err, items) {
  var md5sums = [];
  if (err) {
    console.log(err);
    return
  }
  for (var item of items) {
    item.endsWith('.md5') && md5sums.push(item)
  }
  var md5FileNum = md5sums.length
  const logFileStream = fs.createWriteStream(path.join(process.env.IMAGE_MD5_CHECKSUMS_PATH, 'conversion.log'))
  logFileStream.write = util.promisify(logFileStream.write)
  if (0 === md5FileNum) return resultCallback(null, undefined, 0, logFileStream)
  return memcacheClient.add('isPicValidating', 1)
    .then(() => {
      logFileStream.setMaxListeners(20)
      return memcacheClient.set('IMAGE_MD5_CHECKSUMS_FILES', md5sums)
        .then(() => {
          var deletes = [];
          for (let md5File of md5sums) {
            deletes.push(memcacheClient.delete(md5File))
          }
          return Promise.all(deletes).then(() => {
            const validates = []
            for (let md5File of md5sums) {
              try {
                fs.accessSync(path.join(process.env.IMAGE_MD5_CHECKSUMS_PATH, md5File))
                validates.push(() => { return validatePictures(md5File, --md5FileNum, logFileStream) })
              }
              catch (err) {
                check_isPicValidating = false
                if ('ENOENT' === err.code) console.log(md5File+': removed')
                else if ('EPRM' === err.code) console.log(md5File+': no access')
                else throw err
              }
            }
            function exec(allResults) {
              allResults = allResults || []
              return validates[0]()
                .then((currentResult) => {
                  validates.shift()
                  return validates[0] ? exec([...allResults, currentResult]) : allResults
                })
                .catch((err) => {
                  validates.shift()
                  return validates[0] ? exec([...allResults, err]) : allResults
                })
            }
            return exec()
              .then((results) => {
                const imageFilesProcessed = getImageFilesProcessed()
                0 === imageFilesProcessed &&
                  logFileStream.end() &&
                  memcacheClient.delete('isPicValidating')
              })
          })
        })
    })
    .catch((err) => {
      check_isPicValidating = false
      return logFileStream.write('Cannot validate files in ' + md5sums[0] + '. Another picture validation is running.\n')
        .finally(() => {
          logFileStream.end()
        })
    })
}

var conversions_to_go = 0
var check_isPicValidating = false

function validatePictures(filename, md5FileNum, logStream, is_not_startup) {
  const relativeCSumPath = path.relative(process.env.IMAGE_DATA_PATH, process.env.IMAGE_MD5_CHECKSUMS_PATH)
  setAfterImageFileProcessing(() => {
    afterImageFileProcessing(logStream)
  })
  if (process.env.NO_VALIDATION_AT_STARTUP && is_not_startup !== true)
    return logStream.write('Validation at startup disabled. Not checking files in '+filename+'.\n')
    .then(() => {
      return resultCallback(null, filename, md5FileNum, logStream)
    })
    .catch((err) => {
      return resultCallback(err, filename, md5FileNum, logStream)
    })
  return md5sumValidate(process.env.IMAGE_DATA_PATH, path.join(relativeCSumPath, filename),
    (filename, to_go) => {
      conversions_to_go = to_go
      if (filename.search(validInFileExts) !== -1) {
        logStream.write(filename + ': OK\n')
        processImageFile(path.join(process.env.IMAGE_DATA_PATH, filename),
          path.join(process.env.IIIF_DATA_PATH, filename.replace(validInFileExts, '.jp2')),
          logStream)
      }
    })
    .then(() => {
      return resultCallback(null, filename, md5FileNum, logStream)
    })
    .catch((err) => {
      return resultCallback(err, filename, md5FileNum, logStream)
    })
}

function resultCallback(err, md5File, md5FileNum, logStream) {
  if (!md5File) return memcacheClient.delete('isPicValidating')
  if (err) {
    const message = 'Error: '+md5File + ': ' + err.toString()
    logStream && logStream.write(message + '\n')
    console.log(message);
    return memcacheClient.set(md5File, 'error')
      .then(() => {
        if (md5FileNum === 0) {
          logStream && getImageFilesProcessed() === 0 &&
            logStream.end()
          return memcacheClient.delete('isPicValidating')
        }
      })
  } else {
    return memcacheClient.set(md5File, 'checked')
      .then(() => {
        if (md5FileNum === 0) {
          const imageFilesProcessed = getImageFilesProcessed()
          logStream && imageFilesProcessed === 0 &&
            logStream.end()
          return memcacheClient.delete('isPicValidating')
        }
      })
  }
}

function afterImageFileProcessing(logStream) {
  if (0 === conversions_to_go) {
    logStream && logStream.end()
    memcacheClient.delete('isPicValidating')
    setAfterImageFileProcessing(undefined)
  }
}

fs.watch(process.env.IMAGE_MD5_CHECKSUMS_PATH, (eventType, filename) => {
  if (filename && filename.endsWith('.md5')) {
    console.log('MD5: ' + eventType + ': ' + filename)
    try {
      const md5FullFileName = path.join(process.env.IMAGE_MD5_CHECKSUMS_PATH, filename)
      relativeCSumPath = path.relative(process.env.IMAGE_DATA_PATH, process.env.IMAGE_MD5_CHECKSUMS_PATH)
      fs.accessSync(md5FullFileName)
      const logFileStream = fs.createWriteStream(path.join(process.env.IMAGE_MD5_CHECKSUMS_PATH, filename.replace('.md5', '-conversion.log')))
      logFileStream.write = util.promisify(logFileStream.write)
      check_isPicValidating = true
      return memcacheClient.add('isPicValidating', 1)
        .then(() => {
          logFileStream.setMaxListeners(20)
          return memcacheClient.get('IMAGE_MD5_CHECKSUMS_FILES')
          .then((md5Files) => {
            md5Files = md5Files || []
            md5Files.push(filename)
            md5Files = [...new Set(md5Files)]
            return memcacheClient.set('IMAGE_MD5_CHECKSUMS_FILES', md5Files)
              .then(() => {
                return memcacheClient.delete(filename)
                  .then(() => {
                    return validatePictures(filename, 0, logFileStream, true)
                  })
              })
          })
          .catch((err) => {
            console.log('MD5: '+err.toString())
            memcacheClient.delete('isPicValidating')
          })
        })
        .catch((err) => {
          check_isPicValidating = false
          return logFileStream.write('Cannot validate files in ' + filename + '. Another picture validation is running.\n')
            .finally(() => {
              logFileStream.end()
            })
        })
    }
    catch (err) {
      check_isPicValidating = false
      if ('ENOENT' === err.code) console.log('MD5: '+filename+': removed')
      else console.log(err.toString())
    }    
  } else {
    // is reported very often and there is nothing obvios to do anyway
    // console.log('MD5: ' + eventType + ': filename not provided');
  }
});

fs.readdir(process.env.IMAGE_MD5_CHECKSUMS_PATH, updateMD5Checksums);

// http://localhost:3000/memcached?set[key]=test&set[value]=x
// http://localhost:3000/memcached?get=test => x
// http://localhost:3000/memcached?get[]=test => test: x
// Set many values at once (but not arrays of values):
// http://localhost:3000/memcached?set[0][key]=test&set[0][value]=testing&set[1][key]=test2&set[1][value]=testing
// http://localhost:3000/memcached?get[]=test&get[]=test2
// http://localhost:3000/memcached?del=test&del=test2
service.get('/memcached', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {      
  if (undefined !== req.query.set) {
    if (Array.isArray(req.query.set)) {
      var setters = [];
      for (let pair of req.query.set) {
        await setters.push(memcacheClient.set(pair.key, pair.value))
      }
      res.send('{"All set": ' + JSON.stringify(req.query.set)+'}')
    } else {
      await memcacheClient.set(req.query.set.key, req.query.set.value)
      res.send('{"Set": ' + JSON.stringify(req.query.set)+'}') 
    }
  }
  else if (undefined !== req.query.get) {
    if (Array.isArray(req.query.get)) {
      const values = await memcacheClient.getMulti(req.query.get)
      res.send(JSON.stringify(values))
    }
    else {
      const value = await memcacheClient.get(req.query.get)
      res.send(JSON.stringify(value))
    }
  }
  else if (undefined !== req.query.del) {
    if (Array.isArray(req.query.del)) {
      var deleters = [];
      for (var name of req.query.del)
        await deleters.push(memcacheClient.delete(name))
      res.send('{"All deleted": ' + JSON.stringify(req.query.del)+'}')
    }
    else {
      const value = await memcacheClient.delete(req.query.del)
      res.send('{"Deleted": ' + req.query.del+'}')
    }
  }
  else {
    const values = await memcacheClient.getMulti(['isPicValidating', 'IMAGE_MD5_CHECKSUMS_FILES'])
    const filesValues = values.IMAGE_MD5_CHECKSUMS_FILES ? await memcacheClient.getMulti(values.IMAGE_MD5_CHECKSUMS_FILES) : {}
      values.IMAGE_MD5_CHECKSUMS_FILES = filesValues
      res.send(JSON.stringify(values)) 
    }
  } catch (err) {
    res.send(JSON.stringify(err.toString()), 400)
  }
})

// Serve directory indexes for images/tiff folder (with icons)
function renderDirectory(template, locals, callback) {
  // read template
  fs.readFile(template, 'utf8', function (err, str) {
    if (err) return callback(err);
    
    locals.style = locals.style.concat(indexHelpers.iconStyle(locals.fileList, locals.displayIcons));

    var hrefBase = locals.directory
                  .split('/')
                  .map(function (c) { return encodeURIComponent(c); })
                  .join('/');
    var imageHref = path.join(process.env.IIIF_DATA_PATH, locals.directory.replace('/images', ''));
    for (let file of locals.fileList) {
      file.hrefPath = hrefBase + encodeURIComponent(file.name);
      file.thisHost = requestHost,
      file.wantDetails = locals.viewName == 'details';
      var classes = [];
      var isDir = file.stat && file.stat.isDirectory();
      var forIIIFPath = path.join(imageHref, file.name);
      if (locals.displayIcons) {
        classes.push('icon');
  
        if (isDir) {
          classes.push('icon-directory');
        } else {
          var ext = path.extname(file.name);
          var icon = indexHelpers.iconLookup(file.name);
  
          classes.push('icon');
          classes.push('icon-' + ext.substring(1));
  
          if (classes.indexOf(icon.className) === -1) {
            classes.push(icon.className);
          }
        }
        file.classes = classes.join(' ');
      }
      file.date = file.stat && file.name !== '..'
      ? file.stat.mtime.toLocaleDateString() + ' ' + file.stat.mtime.toLocaleTimeString()
      : '';
      file.size = file.stat && !isDir
      ? file.stat.size
      : '';
      file.isDir = isDir
      ? file.name === '..' ? {isDotDot: true}
      : {}
      : false
      file.jp2Exists = file.name !== '..' && fs.existsSync(forIIIFPath)
      file.tifExists = file.name !== '..' && fs.existsSync(forIIIFPath.replace(/(\.tif)|(\.jpg)/, '.jp2'))
      file.imageURL = file.jp2Exists || file.tifExists
      ? isDir ? hrefBase.replace('/images/', '/forIIIF/') + encodeURIComponent(file.name)
      : {
        jp2: hrefBase.replace('/images/', '/iiif/images/') + encodeURIComponent(file.name).replace(/(\.tif)|(\.jpg)/, '.jp2'),
        tif: hrefBase.replace('/images/', '/iiif/images/') + encodeURIComponent(file.name),
      }
      : undefined
      file.imageURL && isDir ? file.manifestFolder = process.env.DEFAULT_COLLECTION+"-"+file.imageURL.replace(/^\/forIIIF\/([^\/]+).*/, "$1") : undefined
    }
    var body = mustache.render(str, locals);

    callback(null, body);
  });
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const index = serveIndex(process.env.IMAGE_DATA_PATH, {
  'icons': true,
  'template': (locals, callback) => {renderDirectory(path.join(__dirname, 'public/directory.html'), locals, callback)},
  'stylesheet': path.join(__dirname, 'public/style.css')
})
const staticFiles = serveStatic(process.env.IMAGE_DATA_PATH);

// the /images route handler
service.get('/images', (req, res) => {
  const done = finalhandler(req, res)
  const changedReq = req;
  changedReq.originalUrl = req.url;
  changedReq.url = "/";
  requestHost = "https://"+req.headers.host
  staticFiles(changedReq, res, (err) => {
    if (err) return done(err)
    index(changedReq, res, done)
  });
})

// the /images/.* route handler
service.get('/images/*', (req, res) => {
  const done = finalhandler(req, res)
  const changedReq = req;
  changedReq.originalUrl = req.url;
  changedReq.url = req.url.replace("/images/", "/");
  staticFiles(changedReq, res, (err) => {
    if (err) return done(err)
    index(changedReq, res, done)
  });
})

service.post('/images/*', (req, res) => {
  const headers = {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked'
  }
  const inDir = path.normalize(decodeURI(req.body.path||req.url).replace('/images', process.env.IMAGE_DATA_PATH))
  const outDir = path.normalize(decodeURI(req.body.path||req.url).replace('/images', process.env.IIIF_DATA_PATH))
  fs.mkdir(outDir, { recursive: true }, (err) => {
    if (err) {
      res.send(err.toString(), 500)
      return
    }
    const logFileStream = fs.createWriteStream(path.join(outDir, 'conversion.log'))
    var firstStream = logFileStream,
        secondStream
    firstStream.setMaxListeners(20)
    if (req.httpVersion === '1.1') {
      firstStream = res
      secondStream = logFileStream
      const firstWrite = firstStream.write
      var firstStreamClosed = !firstStream.writable
      function writeBoth(chunk, encoding, done) {
        done = typeof encoding === 'function' ? encoding : done
        if (firstStreamClosed) { return writeSecondStream(chunk, typeof encoding === 'function' ? undefined : encoding, done) }
        if (firstStream.writable && !firstWrite.apply(firstStream, [chunk, typeof encoding === 'function' ? undefined : encoding])) {
          const timeout = setTimeout(() => {
            firstStreamClosed = true
            writeSecondStream(chunk, typeof encoding === 'function' ? undefined : encoding, done)
          }, 2000)
          firstStream.once('drain', () => {
            clearTimeout(timeout)
            writeSecondStream(chunk, typeof encoding === 'function' ? undefined : encoding, done)
          });
        } else {
          process.nextTick(() => {
            writeSecondStream(chunk, typeof encoding === 'function' ? undefined : encoding, done)
          });
        }
        function writeSecondStream(chunk, encoding, done) {
          if (secondStream.writable && !secondStream.write(chunk, typeof encoding === 'function' ? undefined : encoding)) {
            const timeout = setTimeout(() => {
              throw new Error('No stream is writeable for 2s!')
            }, 2000)
            return secondStream.once('drain', () => {
              clearTimeout(timeout)
              done && done()
            })
          } else {
            return done && process.nextTick(() => {
              done()
            })
          }
        }
      }
      firstStream.write = writeBoth
      res.writeHead(200, headers)
    } else {
      fs.readFile('public/convertinprogress.html', 'utf8', function (err, str) {
        if (err) return res.send(err.toString())
        res.send(mustache.render(str, {
          directory: path.join(outDir, 'conversion.log'),
          href: path.join((req.body.path || req.url).replace('/images', '/forIIIF'), 'conversion.log')
        }), 200, {'Content-Type': 'text/html'})
      })
    }
    imageProcessor(
      inDir,
      outDir,
      firstStream,
      (err) => {
        const done = () => {
          firstStream.end()
          if (req.httpVersion === '1.1') secondStream.end()
        }
        if (err) firstStream.write(err.toString(), done)
        else done()
      })
  })
})

// Serve directory indexes for JPEG2000 folder (with icons)
const indexIIIF = serveIndex(process.env.IIIF_DATA_PATH, {'icons': true})
const staticFilesIIIF = serveStatic(process.env.IIIF_DATA_PATH);

// the /images route handler
service.get('/forIIIF', (req, res) => {
  const done = finalhandler(req, res)
  const changedReq = req;
  changedReq.originalUrl = req.url;
  changedReq.url = "/";
  staticFilesIIIF(changedReq, res, (err) => {
    if (err) return done(err)
    indexIIIF(changedReq, res, done)
  });
})

// the /images/.* route handler
service.get('/forIIIF/*', (req, res) => {
  const done = finalhandler(req, res)
  const changedReq = req;
  changedReq.originalUrl = req.url;
  changedReq.url = req.url.replace("/forIIIF/", "/");
  staticFilesIIIF(changedReq, res, (err) => {
    if (err) return done(err)
    indexIIIF(changedReq, res, done)
  });
})

// start the server
service.start(process.env.PORT||3000).then((server) => {
    console.log('Listening on port ' + server.address().port); //Listening on port 3000
})
