const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process');
const async = require('async')
const { format } = require('util')
const { cpus } = require('os')

module.exports.validInFileExts = /\.(tif|tiff|jpg|jpeg|png)$/i;

module.exports.imageProcessor = function(inDir, outDir, logStream, done) {
  readInDirSetupOutDir(null, inDir, outDir, [], (err, files) => {
    if (err) return done(err)
    doWithFiles(inDir, outDir, logStream, done, files)
  })
}

const processingQueue = async.queue(processImage, cpus().length)

function processImage(args, done) {
  const todo = async.waterfall([
    async.constant(args.inFile, args.outFile, args.logStream),
    createCroppedTiff,
    //create2xZoomedTiff,
    //createPyramidTiffDeflate,
    //createPyramidTiffLZW,
    createOpenJPEG,
    removeCroppedFile    
  ], (err) => {
    done(err)
  })
}

module.exports.processImageFile = function(inFile, outFile, logStream) {
  if (inFile.search(module.exports.validInFileExts) && outFile.search(/\.(tif|jp2)$/) !== -1) {
    const outFileParsed = path.parse(outFile)
    try {
      fs.accessSync(outFileParsed.dir)
    }
    catch (err) {
      if ('ENOENT' === err.code) {
        fs.mkdirSync(outFileParsed.dir, {recursive: true})
      }
      else throw err
    }
    try {
      fs.accessSync(outFile)
      logStream.write('Converted image '+outFile+' exists.\n')
    }
    catch (err) {
      if ('ENOENT' === err.code) {
        processingQueue.push({
          inFile: inFile,
          outFile: outFile.replace(/\.(tif|jp2)$/, '-c.tif'),
          logStream: logStream
        })
      }      
      else throw err
    }
  } else {
    throw new Error(`Need inFile as ${module.exports.validInFileExts.toString()} and outFile as tif|jp2`)
  }
}

module.exports.setAfterImageFileProcessing = function(done) {
  processingQueue.drain(done)
}

module.exports.getImageFilesProcessed = function() {return processingQueue.length()+processingQueue.running()}

function readInDirSetupOutDir(err, inDir, outDir, files, done) {
  if (err) return done(err)
  fs.readdir(inDir, { encoding: "utf8", withFileTypes: true }, (err, entries) => {
    if (err) return done(err)
    fs.mkdir(outDir, { recursive: true }, (err) => {
      if (err) return done(err)
      var i = 0;
      (function next(i) {
        if (i === entries.length)
          return done(null, files)
        if (entries[i].isFile()) {
          if (entries[i].name.search(module.exports.validInFileExts) !== -1) files.push(path.join(inDir, entries[i].name))
          next(++i)
        }
        else if (entries[i].isDirectory()) readInDirSetupOutDir(
          null,
          path.join(inDir, entries[i].name),
          path.join(outDir, entries[i].name),
          files, () => {
            next(++i)
          })
      })(0)
    })
  })
}

function doWithFiles(inDir, outDir, logStream, done, files) {
  const start = process.hrtime()
  const processingQueue = async.queue(processImage, cpus().length)
  processingQueue.drain(() => {
    var took = process.hrtime(start)
    logStream.write(format('Took %ds %dms. Done.\n', took[0], took[1] / 1000000), done)
  })
  for (let file of files) {
    if (file.search(module.exports.validInFileExts) !== -1)
      processingQueue.push({
        inFile: file,
        outFile: file.replace(inDir, outDir).replace(module.exports.validInFileExts, '-c.tif'),
        logStream: logStream
      })
  }
}

function createCroppedTiff(inFile, outFile, logStream, done) {
  var imageData = '',
    background = '',
    picture_area = '',
    width = 0,
    height = 0
  const subprocess = execFile('vipsheader', [
    '-a',
    inFile
  ], (err, stdout, stderr) => {
    if (err) {
      return logStream.write(err.toString() + '\n', () => {
        done(err)
      })
    }
    logStream.write('Image data: ' + imageData + '\n')
    width = Number(imageData.match(/^width: (\d+)$/m)[1])
    height = Number(imageData.match(/^height: (\d+)$/m)[1])
    const subprocess = execFile('vips', [
      'getpoint',
      inFile,
      2, 2
    ], (err, stdout, stderr) => {
      if (err) {
        return logStream.write(err.toString() + '\n', () => {
          done(err)
        })
      }
      logStream.write('Background color: ' + background + '\n')
      const subprocess = execFile('vips', [
        'find_trim',
        inFile,
        '--threshold=30',
        '--background=' + background
      ], (err, stdout, stderr) => {
        if (err) {
          return logStream.write(err.toString() + '\n', () => {
            done(err)
          })
        }
        const picture_dim = picture_area.split(/\r?\n/),
              picture_dim_border = [
                Math.max(Number(picture_dim[0]) - 10, 0),
                Math.max(Number(picture_dim[1]) - 10, 0),
                Math.min(Number(picture_dim[2]) + 10 + 10, width - picture_dim[0]),
                Math.min(Number(picture_dim[3]) + 10 + 10, height - picture_dim[1])
              ]
        // logStream.write('Scan size: '+width+'x'+height + '\n' +
        // 'Picture area: ' + picture_dim.join('x') + '\n' +
        // 'Picture area with border: ' + picture_dim_border.join('x') + '\n')
        const subprocess = execFile('vips', [
          'crop',
          inFile,
          outFile,
          picture_dim_border[0],
          picture_dim_border[1],
          picture_dim_border[2],
          picture_dim_border[3]
          //        '--interesting', 'entropy'
        ], (err, stdout, stderr) => {
          if (err) {
            return logStream.write(err.toString() + '\n', () => {
              done(err)
            })
          } else return done(null, inFile, outFile, logStream)
        })
        subprocess.stderr.pipe(logStream, { end: false })
      })
      subprocess.stdout.on('data', (chunk) => {
        picture_area = (picture_area + '\n' + chunk.toString()).trim()
      })
      subprocess.stderr.pipe(logStream, { end: false })
    })
    subprocess.stdout.on('data', (chunk) => {
      background = (background + '\n' + chunk.toString()).trim()
    })
    subprocess.stderr.pipe(logStream, { end: false })
  })
  subprocess.stdout.on('data', (chunk) => {
    imageData = (imageData + '\n' + chunk.toString()).trim()
  })
  subprocess.stderr.pipe(logStream, { end: false })
}

function create2xZoomedTiff(inFile, outFile, logStream, done) {
  const subprocess = execFile('vips', [
    'zoom',
    inFile,
    outFile,
    '2',
    '2'
  ], (err, stdout, stderr) => {
    if (err) {
      return logStream.write(err.toString() + '\n', () => {
        done(err)
      })
    } else return done(null, inFile, outFile, logStream)
  })
  subprocess.stderr.pipe(logStream, { end: false })
}

function createOpenJPEG(inFile, outFile, logStream, done) {
  const subprocess = execFile('opj_compress' , [
    '-i', outFile, //input
    '-o', outFile.replace('-c.tif', '.jp2'), //output
    '-r', '20,10,5,2.5', //Compression ratio values. Used to define the different levels of compression. Must be from left to right in descending order
    '-n', '7', //Number of resolutions
    '-c', '[256,256]',//Precinct size.
    '-b', "64,64",//Code-block size.  The maximum value authorized is 64x64. Default: 64x64.
    '-p', 'RPCL',//Progression order. One of LRCP, RLCP, RPCL, PCRL and CPRL. Default: LRCP.
    '-SOP', //SOP marker before each packet.
    '-t', '512,512',//Tile size.
    '-TP', 'R',//Tile marker (?)
    '-threads', '8',//use 8 threads
  ], (err, stdout, stderr) =>{
    if (err) {
      logStream.write(err.toString()+'\n')
      return done(err)
    }
    logStream.write('created JPEG2000 '+outFile+' -> '+outFile.replace('-c.tif', '.jp2')+'\n', () => {
      done(null, inFile, outFile, logStream)}
    )
  })
  subprocess.stdout.pipe(logStream, {end: false})
  subprocess.stderr.pipe(logStream, {end: false})
}

function createPyramidTiffLZW(inFile, outFile, logStream, done) {
  const subprocess = execFile('vips' , [
    'tiffsave',
    outFile,
    outFile.replace('-c.tif', '-lzw.tif'),
    '--tile', '--pyramid', '--tile-width', '256', '--tile-height', '256',
    '--compression', 'lzw'
  ], (err, stdout, stderr) =>{
    if (err) {
      return logStream.write(err.toString()+'\n', () => {
        done(err)
      })
    } else return done(null, inFile, outFile, logStream)        
  })
  subprocess.stderr.pipe(logStream, {end: false})
}


function createPyramidTiffDeflate(inFile, outFile, logStream, done) {
  const subprocess = execFile('vips' , [
    'tiffsave',
    outFile,
    outFile.replace('-c.tif', '-deflate.tif'),
    '--tile', '--pyramid', '--tile-width', '256', '--tile-height', '256',
    '--compression', 'deflate'
  ], (err, stdout, stderr) =>{
    if (err) {
      return logStream.write(err.toString()+'\n', () => {
        done(err)
      })
    } else return done(null, inFile, outFile, logStream)        
  })
  subprocess.stderr.pipe(logStream, {end: false})
}

function removeCroppedFile(inFile, outFile, logStream, done) {
  fs.unlinkSync(outFile)
  logStream.write('removing intermediate '+outFile+'\n', 'utf-8', () => {
    done(null)
  }) 
}