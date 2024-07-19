const util = require('util');
const fs = require('fs');
const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir)
const path = require('path');
const mustache = require('mustache')
const _ = require("lodash")

module.exports = function(service) {
    service.get('/iiif/presentation/collection/:collectionName', (req, res) => { respond(req, res, 'collection') })
    service.get('/iiif/presentation/:collectionName-name/manifest', (req, res) => { respond(req, res, 'manifest') })
    service.get('/iiif/presentation/:collectionName/sequence/:name', (req, res) => { respond(req, res, 'sequence') })
    service.get('/iiif/presentation/:collectionName-name/canvas/:name', (req, res) => { respond(req, res, 'canvas') })
    service.get('/iiif/presentation/:collectionName/annotation/:name', (req, res) => { respond(req, res, 'image') })
    service.get('/iiif/presentation/:collectionName/html-annotation/:name', (req, res) => { respond(req, res, 'html-annotation') })
    service.get('/iiif/presentation/:collectionName/res/:name', (req, res) => { respond(req, res, 'imageRes') })
    service.get('/iiif/presentation/:collectionName/list/:name', (req, res) => { respond(req, res, 'annotationList') })
}

const servedExt = ".jp2"
const inDir = process.env.IMAGE_DATA_PATH
const outDir = process.env.IIIF_DATA_PATH
const manifestsMetadataDefault = {
    "inDirFilterRegExp": "(.*)",
    "labelTransform": {
      "regExp": "(.*)",
      "replace": "Label for $1"
    },
    "metadata": [{
        "label": "Author",
        "value": "Please define manifestsMetadata in your config JSON!"
      }
    ],
    "navDate": "2019-01-01T00:00:00Z",
    "canvasMetadata": {
      "width": 1500,
      "height": 2500,
      "thumbnailWidth": 300,
      "thumbnailHeight": 500
    }
  }

var collectionTemplate = ""
var manifestTemplate = ""
var templatePartials = {}
var inDirEnts = []
var outDirEnts = []
var outDirWatchers = {}
var inDirWatchers = {}
var getAllSequencesLock = false
var updateSequencesLock = false
var inDirWatchersLock = false
var manifestMetadata = {}
var manifests = {}
var canvases = {}
var RetryENOENTCount = 0

module.exports.manifestMetadata = manifestMetadata

async function initModule() {
    collectionTemplate = await readFile('public/collection.mustache', 'utf8'),
    manifestTemplate = await readFile('public/manifest.mustache', 'utf8'),
    templatePartials = {
      annotation: await readFile('public/annotation.mustache', 'utf8'),
      annotationList: await readFile('public/annotationList.mustache', 'utf8'),
      manifestRef: await readFile('public/manifestRef.mustache', 'utf8'),
      sequence: await readFile('public/sequence.mustache', 'utf8'),
      sequenceRef: await readFile('public/sequenceRef.mustache', 'utf8'),
      canvas: await readFile('public/canvas.mustache', 'utf8'),
      canvasRef: await readFile('public/canvasRef.mustache', 'utf8'),
      image: await readFile('public/image.mustache', 'utf8'),
      range: await readFile('public/range.mustache', 'utf8')
    }
    await getAllCollections()
    await getAllSequences()
}

initModule()

async function getAllCollections() {
    if (inDirWatchersLock) return
    inDirWatchersLock = true
    for (let key of Object.keys(inDirWatchers)) {
        inDirWatchers[key].close()
        delete inDirWatchers[key]
    }
    inDirEnts = await readDirRetryENOENT(inDir, {withFileTypes: true})
    for (let inDirEnt of inDirEnts) {
        if (inDirEnt.name.endsWith('.json') && inDirEnt.isFile()) {
            inDirEnt.name = path.resolve(inDir, inDirEnt.name)
            await updateManifestMetadata(inDirEnt)
            inDirWatchers[inDirEnt.name] = fs.watch(inDirEnt.name, async (eventType) => {
                try {
                    fs.accessSync(inDirEnt.name)                    
                    updateManifestMetadata(inDirEnt)
                } catch (err) {
                    console.log(inDirEnt.name+': <'+eventType+'> '+err.toString())
                    inDirWatchers[inDirEnt.name].close()
                    delete inDirWatchers[inDirEnt.name]
                    delete manifestMetadata[path.parse(inDirEnt.name).name]
                }
            })
            .on('error', (err) => {
                console.log(inDirEnt.name+': '+err.toString())
                delete inDirWatchers[inDirEnt.name]
            })
        }
    }
    inDirWatchers[inDir] = fs.watch(inDir, async (eventType, fileName) => {
        try {
            console.log('<'+eventType+'> '+fileName)
            fs.accessSync(inDir) 
            getAllCollections()
        } catch (err) {
            console.log(inDir+': <'+eventType+'> '+err.toString())
            inDirWatchers[nDir].close()
            delete inDirWatchers[inDir]
        }
    })
    .on('error', (err) => {
        console.log(inDir+': '+err.toString())
        delete outDirWatchers[inDir]
    })
    inDirWatchersLock = false
}

async function updateManifestMetadata(inDirEnt) {
    try {
        const manifestName = path.parse(inDirEnt.name).name
        manifestMetadata[manifestName] = JSON.parse(await readFile(inDirEnt.name))
        manifestMetadata[manifestName].manifestsMetadata = manifestMetadata[manifestName].manifestsMetadata || manifestsMetadataDefault
    } catch (err) {
        console.error(err.toString())
    }
}

async function getAllSequences() {
    if (getAllSequencesLock || updateSequencesLock) return
    getAllSequencesLock = true
    manifests = {}
    canvases = {}
    for (let key of Object.keys(outDirWatchers)) {
        outDirWatchers[key].close()
        delete outDirWatchers[key]
    }
    try {
        outDirEnts = await readDirRetryENOENT(outDir, { withFileTypes: true })
        for (let outDirEnt of outDirEnts) {
            outDirEnt.name = path.resolve(outDir, outDirEnt.name)
            if (outDirEnt.isDirectory()) {
                var manifestName = path.parse(outDirEnt.name).name,
                    imageFiles = []
                await getAllServedImages(outDirEnt.name, outDirEnt.name, await readDirRetryENOENT(outDirEnt.name, { withFileTypes: true }), imageFiles, manifestName)
                manifests[manifestName] = manifests[manifestName] ? [...new Set(imageFiles.concat(manifests[manifestName]))] : imageFiles
                console.log('Found ' + manifests[manifestName].length + ' images in ' + outDirEnt.name + ' for manifest ' + manifestName)
                if (manifests[manifestName] && 0 === manifests[manifestName].length)
                    delete manifests[manifestName]
                const watcherCurrentDir = outDirEnt.name,
                      watcherManifestName = manifestName
                createOutDirWatcher(outDirEnt.name, async () => {
                    await updateSequences(watcherCurrentDir, watcherManifestName, 'getAllSequence watcher')
                })
            }
        }
    }
    catch (err) {
        if (err.code === 'ENOENT' && RetryENOENTCount <= 10) {
            console.log(err.toString())
        }
        else throw err
    }
    try {
        createOutDirWatcher(outDir, getAllSequences)
    }
    catch (err) {
        if (err.code === 'ENOENT' && RetryENOENTCount <= 10) {
            console.log(err.toString())
        }
    }
    for (let manifestName of Object.keys(manifests)) {
        for (let filePath of manifests[manifestName]) {
            canvases[path.parse(filePath).name] = filePath
        }
    }
    getAllSequencesLock = false
}

function createOutDirWatcher(outDir, processDir) {
    outDirWatchers[outDir] && outDirWatchers[outDir].close()
    delete outDirWatchers[outDir]
    outDirWatchers[outDir] = fs.watch(outDir, async (eventType, fileName) => {
        try {
            if (getAllSequencesLock || updateSequencesLock) return
            console.log(outDir+': <'+eventType+'> '+fileName)
            fs.accessSync(outDir) 
            await processDir()
        } catch (err) {
            console.log(outDir+': <'+eventType+'> '+err.toString())
            outDirWatchers[outDir] && outDirWatchers[outDir].close()
            delete outDirWatchers[outDir]
        }
    })
    .on('error', (err) => {
        console.log(outDir+': '+err.toString())
        delete outDirWatchers[outDir]
    })
}

async function updateSequences(currentDir, manifestName, origin) {
    if (getAllSequencesLock || updateSequencesLock) return
    updateSequencesLock = true
    var imageFiles = []
    await getAllServedImages(currentDir, currentDir, await readDirRetryENOENT(currentDir, {withFileTypes: true}), imageFiles, manifestName)    
    manifests[manifestName] = manifests[manifestName] ? [...new Set(imageFiles.concat(manifests[manifestName]))] : imageFiles
    console.log(origin+': Found '+manifests[manifestName].length+' images in '+currentDir+' for manifest '+manifestName)
    updateSequencesLock = false
}

async function getAllServedImages(rootDir, currentDir, subDirEnts, imageFiles, manifestName) {
    for (let subDirEnt of subDirEnts) {
        try {
            subDirEnt.name = path.resolve(currentDir, subDirEnt.name)
            if (subDirEnt.isDirectory()) {
                const watcherCurrentDir = rootDir,
                      watcherManifestName = manifestName
                createOutDirWatcher(subDirEnt.name, async () => {
                    await updateSequences(watcherCurrentDir, watcherManifestName, 'updateSequence watcher')
                })
                await getAllServedImages(rootDir, subDirEnt.name, await readDirRetryENOENT(subDirEnt.name, { withFileTypes: true }), imageFiles, manifestName)
            } else if (subDirEnt.name.endsWith(servedExt) && subDirEnt.isFile() && !subDirEnt.name.endsWith('-c.tif')) {
                imageFiles.push(path.relative(outDir, subDirEnt.name).split(path.sep).join('/'))
            }
        }
        catch (err) {
            console.log(currentDir+' > '+subDirEnt.name+': '+err.toString())
        }
    }
}

async function readDirRetryENOENT(path, options) {
  var ret
  RetryENOENTCount++
  try {
      ret = await readDir(path, options)
  }
  catch (err) {
      if (err.code === 'ENOENT' && RetryENOENTCount <= 9) {
          console.log('Retry readDir')
          return await readDirRetryENOENT(path, options)
      }
      throw err
  }
  RetryENOENTCount = 0
  return ret
}

async function respond(req, res, type) {
    // mustache by default provides this to partials. We use partials also on their own. So this is copied.
    const commonData = {}
    const scheme = req.headers.host.search(/^localhost/) === -1 ? 'https://' : 'http://'
    commonData.url = scheme + req.headers.host + '/iiif/presentation'
    // commonData.iiifImagesURL = 'https://' + req.headers.host + '/iiif/images'
    commonData.iiifImagesURL = scheme + req.headers.host.replace(/:\d\d\d\d/, ':8080') + '/iiif/images'
    commonData.collectionName = decodeURI(req.params.collectionName || req.params["collectionName-name"] || "").replace(/^(.[^-]+)-(.+)$/, '$1')
    commonData.manifestPath =  decodeURI(req.params.name || req.params["collectionName-name"] || "").replace(/^(.[^-]+)-(.+)$/, '$2')
   commonData.isLast = false
    const data = Object.assign({}, commonData)
    if (type === 'imageRes') commonData.manifestPath = path.basename(commonData.manifestPath, '.jpg')
    if (manifestMetadata[commonData.collectionName] === undefined) return send404(res)
    switch (type) {
        case 'manifest':
        case 'sequence': if (manifests[commonData.manifestPath] === undefined) return send404(res); else break
        case 'canvas':
        case 'image':
        case 'imageRes': if (canvases[commonData.manifestPath] === undefined) return send404(res); else break
    }
    var metadataInsert = JSON.parse(JSON.stringify(manifestMetadata[commonData.collectionName].manifestsMetadata))
    data.description = manifestMetadata[commonData.collectionName].description
    data.license = manifestMetadata[commonData.collectionName].license
    data.attribution = manifestMetadata[commonData.collectionName].attribution
    const metadata = manifestMetadata[commonData.collectionName].manifestsMetadata || {}
    const labelTransformRegExp = metadata.labelTransform ? new RegExp(metadata.labelTransform.regExp) : undefined
    data.label = manifestMetadata[commonData.collectionName].label
    if (type !== 'collection') data.label = labelTransformRegExp ? commonData.manifestPath.replace(labelTransformRegExp, metadata.labelTransform.replace) : 'missing transform instructions',
    delete metadataInsert.inDirFilterRegExp
    delete metadataInsert.labelTransform
    delete metadataInsert.canvasMetadata
    var metadataInsertRemainder = JSON.stringify(metadataInsert, null, 2).replace(/^\{\n/, '').replace(/\n\}$/, ',')
    data.metadata = metadataInsertRemainder
    var manifestKeys = Object.keys(manifests),
        manifestKey = (type === 'manifest' || type === 'sequence') ? commonData.manifestPath : manifestKeys[0],
        canvasFileName = (type === 'canvas' || type === 'image' ||
                          type === 'imageRes' || type === 'annotationList' ||
                          type === 'html-annotation') ? commonData.manifestPath : false
    data.sequences = []
    data.sequences[0] = createSequenceData(metadata, manifestKey, canvasFileName, commonData)
    data.sequences[0].isLast = true
    if (type === 'manifest') {
        data.ranges = createStructureData(metadata, manifestKey, commonData)        
        data.searchUrl = scheme + req.headers.host + '/iiif/services'
    }
    data.manifests = []
    for (let manifest of manifestKeys) {
        data.manifests.push({
            manifestPath: manifest,
            label:  labelTransformRegExp ? manifest.replace(labelTransformRegExp, metadata.labelTransform.replace) : 'missing transform instructions',
            isLast: false
        })
    }
    data.manifests.length > 0 && (data.manifests[data.manifests.length-1].isLast = true)
    var ret = {}
    var retString = ""
    try {
        switch (type) {
            case 'collection': retString = mustache.render(collectionTemplate, data, templatePartials); break;
            case 'manifest': retString = mustache.render(manifestTemplate, data, templatePartials); break;
            case 'sequence': retString = mustache.render(templatePartials.sequence, data.sequences[0], templatePartials); break;
            case 'html-annotation':
            case 'annotationList':
            case 'canvas': retString = mustache.render(templatePartials.canvas, data.sequences[0].canvases[0], templatePartials); break;
            case 'image':
            case 'imageRes': retString = mustache.render(templatePartials.image, data.sequences[0].canvases[0], templatePartials); break;
        }
        ret = JSON.parse(retString)
        if (ret.structures) {
          for (let range of ret.structures) {
            if (0 === range.canvases.length) delete range.canvases;
            if (0 === range.ranges.length) delete range.ranges;
          }
        }
        res.setHeader('Content-Type', 'application/ld+json');
        if (type === 'imageRes') ret = ret.resource
        if (type === 'annotationList') ret = ret.otherContent[0]
        if (type === 'html-annotation') ret = ret.otherContent[0].resources[0]
        res.send(JSON.stringify(ret))
    } catch (err) {
        ret.data = data
        ret.err = err.toString()
        ret.stack = err.stack
        ret.tryed = retString
        res.setHeader('Content-Type', 'application/json');        
        res.send(JSON.stringify(ret), 500)
    }
}

function createSequenceData(metadata, manifest, canvasFileName, commonData) {
    var ret = Object.assign({}, commonData)
    var metadataInsert = JSON.parse(JSON.stringify(metadata || {}))
    metadataInsert.label = metadataInsert.labelTransform && manifest ? manifest.replace(new RegExp(metadata.labelTransform.regExp), metadata.labelTransform.replace) : 'missing transform instructions'   
    delete metadataInsert.inDirFilterRegExp
    delete metadataInsert.labelTransform
    delete metadataInsert.canvasMetadata
    ret.path = manifest
    ret.metadata = JSON.stringify(metadataInsert, null, 2).replace(/^\{\n/, '').replace(/\n\}$/, ',')
    metadata.canvasMetadata = metadata.canvasMetadata || {}
    ret.thumbnailWidth = metadata.canvasMetadata.thumbnailWidth
    ret.thumbnailHeight = metadata.canvasMetadata.thumbnailHeight
    ret.canvases = []
    const canvasFileNames = canvasFileName ? [canvasFileName] : manifests[manifest]
    if (canvasFileNames) {
        for (let filePath of canvasFileNames) {
            const newCanvas = Object.assign({}, commonData)
            const fileName = path.basename(filePath, servedExt)
            newCanvas.path = fileName
            newCanvas.imageName = fileName
            newCanvas.imagePath = filePath
            newCanvas.image = Object.assign({}, commonData)
            newCanvas.width = metadata.canvasMetadata.width
            newCanvas.height = metadata.canvasMetadata.height
            newCanvas.thumbnailWidth = metadata.canvasMetadata.thumbnailWidth
            newCanvas.thumbnailHeight = metadata.canvasMetadata.thumbnailHeight
            newCanvas.annotationLists = [{
                annotations: [{
                    label: "Filename:",
                    html: fileName,
                    isLast: true
                }],
                isLast: true
            }]
            ret.canvases.push(newCanvas)
        }
        ret.canvases[ret.canvases.length-1].isLast = true
    }
    return ret
}

module.exports.createSequenceData = createSequenceData

function createStructureData(metadata, manifest, commonData) {
    var ranges = []
    var metadataInsert = JSON.parse(JSON.stringify(metadata || {}))
    metadataInsert.label = metadataInsert.labelTransform ? manifest.replace(new RegExp(metadata.labelTransform.regExp), metadata.labelTransform.replace) : 'missing transform instructions'
    commonData.isLast = false
    const topRange = Object.assign({
        label: 'Inhalt ' + metadataInsert.label,
        viewingHint: "top",
        path: manifest,
        rangeURLs: []
    })
    ranges.push(topRange)
    const canvasFileNames = manifests[manifest]
    const canvasGroups = _.groupBy(canvasFileNames, (value) => {return value.split('/')[1]})
    for (let group of Object.keys(canvasGroups)) {
        const range = {
            path: manifest + '-' + group,
            label: group,
            canvasURLs: [],
            within: Object.assign({
               path: manifest 
            }, commonData)
        }
        for (let filePath of canvasGroups[group]) {
            const fileName = path.basename(filePath, servedExt)
                  canvasRef = Object.assign({
                      path: fileName
                  }, commonData)
            range.canvasURLs.push(canvasRef)
        }
        range.canvasURLs[range.canvasURLs.length-1].isLast = true
        ranges.push(range)
        topRange.rangeURLs.push(Object.assign({
            path: range.path
        }, commonData))
    }
    ranges[ranges.length-1].isLast = true
    topRange.rangeURLs[topRange.rangeURLs.length-1].isLast = true
    delete commonData.isLast
    return ranges
}

function send404(res) {    
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({error: 'not found'}), 404)
}