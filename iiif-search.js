const util = require('util');
const fs = require('fs');
const readFile = util.promisify(fs.readFile);
const qs = require('qs');
const mustache = require('mustache')
const _ = require("lodash")
const compression = require('compression')

const { createSequenceData, manifestMetadata } = require('./iiif-presentation')

module.exports = function(service) {
    service.get('/iiif/services/:collectionName-name/search', compression(), (req, res) => { respond(req, res, 'search') })
    service.get('/iiif/services/:collectionName-name/autocomplete', compression(), (req, res) => { respond(req, res, 'autocomplete') })
}
async function initModule() {
    annotationListSearch = await readFile('public/annotationListSearch.mustache', 'utf8'),
    autocompleteTemplate = await readFile('public/autocomplete.mustache', 'utf8'),
    templatePartials = {
        annotation: await readFile('public/annotation.mustache', 'utf8')
    }
}

initModule()

async function respond(req, res, type) {   
    // mustache by default provides this to partials. We use partials also on their own. So this is copied.
    const commonData = {}
    const scheme = 'http://'
    commonData.url = scheme + req.headers.host + '/iiif/presentation'
    commonData.searchUrl = scheme + req.headers.host + '/iiif/services'
    commonData.collectionName = decodeURI(req.params["collectionName-name"].replace(/^(.[^-]+)-(.+)$/, '$1'))
    commonData.name = decodeURI(req.params["collectionName-name"].replace(/^(.[^-]+)-(.+)$/, '$2'))
    commonData.query = '?'+qs.stringify(req.query)
    // commonData.iiifImagesURL = 'https://' + req.headers.host + '/iiif/images'
    commonData.iiifImagesURL = scheme + req.headers.host.replace(/:\d\d\d\d/, ':8080') + '/iiif/images'
    commonData.manifestPath = req.params.name || ""
    commonData.collection = req.params.collectionName
    commonData.isLast = false
    const metadata = manifestMetadata[commonData.collectionName].manifestsMetadata || {}
    const manifestKey = commonData.name
    const data = createSequenceData(metadata, manifestKey, false, commonData)
    data.annotations = data.canvases
    data.canvases = undefined
    _.remove(data.annotations, (annotation) => {
        if (annotation.imageName.startsWith(req.query.q)) {
            for (let key in annotation.annotationLists[0].annotations[0]) {
                if ('isLast' !== key) annotation[key] = annotation.annotationLists[0].annotations[0][key]
            }
            return false
        }
        return true
    })
    data.annotations[data.annotations.length - 1] && (data.annotations[data.annotations.length - 1].isLast = true)
    if ("search" === type) {
        if (manifestMetadata[commonData.collectionName] === undefined) return send404(res)
        var metadataInsert = JSON.parse(JSON.stringify(manifestMetadata[commonData.collectionName].manifestsMetadata))
        data.description = manifestMetadata[commonData.collectionName].description
        data.license = manifestMetadata[commonData.collectionName ].license
        data.attribution = manifestMetadata[commonData.collectionName ].attribution
        const labelTransformRegExp = metadata.labelTransform ? new RegExp(metadata.labelTransform.regExp) : undefined
        data.label = manifestMetadata[commonData.collectionName].label
        data.label = labelTransformRegExp ? commonData.manifestPath.replace(labelTransformRegExp, metadata.labelTransform.replace) : 'missing transform instructions',
            delete metadataInsert.inDirFilterRegExp
        delete metadataInsert.labelTransform
        delete metadataInsert.canvasMetadata
        var metadataInsertRemainder = JSON.stringify(metadataInsert, null, 2).replace(/^\{\n/, '').replace(/\n\}$/, ',')
        data.metadata = metadataInsertRemainder
        // a dummy pixel that UV needs to work. use with options {"zoomToSearchResultEnabled": false} else it will zoom to that corner.
        data.resultAreaHash = '#xywh=0,0,1,1'
    }
    else if ("autocomplete" === type) {
        var terms = [],
            maxTermLength = 0
        for (let idx in data.annotations) {
           terms.push({
               match: data.annotations[idx].imageName,
               count: 1
           })
           maxTermLength = Math.max(maxTermLength, data.annotations[idx].imageName.length)
        }
        function findMoreTerms(terms) {
            maxTermLength--
            var termsToCheck = terms.length > 300 ? _.sampleSize(terms, 300).sort((a, b) => {return a.match.localeCompare(b.match)}) : terms,
                moreTerms = termsToCheck.map((val, idx, terms) => {
                const newVal = JSON.parse(JSON.stringify(val))
                newVal.match = newVal.match.length > maxTermLength ? newVal.match.slice(0, -1) : newVal.match
                newVal.count = terms.reduce((c, val) => {
                    if (val.match.startsWith(newVal.match))
                        return c += val.count
                    else
                        return c
                }, 0)
                return newVal
            })
            var matches = new Set()
            _.remove(moreTerms, (val) => {
                var exists = matches.has(val.match),
                    isToShort = val.match.length < req.query.q.length + 1
                matches.add(val.match)
                return exists || isToShort
            })
            var evenMoreTerms = matches.size <= 1 ? [] : findMoreTerms(moreTerms)
            _.remove(moreTerms, (val) => {return val.count < 5})
            _.remove(evenMoreTerms, (val) => {return val.count < 5})
            return evenMoreTerms.concat(moreTerms)
        }
        terms = findMoreTerms(terms).concat(terms)
        terms[terms.length-1] && (terms[terms.length-1].isLast = true)
        data.terms = terms
    }
    var ret = {}
    var retString = ""
    try {
        switch (type) {
            case 'search': retString = mustache.render(annotationListSearch, data, templatePartials); break;
            case 'autocomplete': retString = mustache.render(autocompleteTemplate, data, templatePartials); break;
        }
        ret = JSON.parse(retString)
        res.setHeader('Content-Type', 'application/ld+json');
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

function send404(res) {    
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({error: 'not found'}), 404)
}