const { imageProcessor } = require('./image-processing')
const fs = require('fs')
const logFileStream = fs.createWriteStream('process-images.log')
const stdoutWrite = process.stdout.write;

function writeBoth(chunk, encoding, done) {
  done = typeof encoding === 'function' ? encoding : done
  if (!stdoutWrite.apply(process.stdout, [chunk, typeof encoding === 'function' ? undefined : encoding])) {
    process.stdout.once('drain', () => {
      writeLogStream(chunk, typeof encoding === 'function' ? undefined : encoding, done)
    });
  } else {
    process.nextTick(() => {
      writeLogStream(chunk, typeof encoding === 'function' ? undefined : encoding, done)}
    );
  }
  function writeLogStream(chunk, encoding, done) {
    if (!logFileStream.write(chunk, typeof encoding === 'function' ? undefined : encoding)) {
      logFileStream.once('drain', () => {
        done()
      })
    } else {
      if (done !== undefined) process.nextTick(() => {
        done()
      })
    }
  }
}

process.stdout.write = writeBoth
process.stdout.setMaxListeners(20)

imageProcessor(process.argv[2], process.argv[3], process.stdout, (err) => {if (err) process.stderr.write(err.toString()+'\n')})