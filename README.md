# Web service for converting scans and serving metadata for the converted images

This repository contains a node based application that
* monitors some directory for new images and checksum files
* converts those images to JPEG2000 in another directory
* provides a web interface to navigate the directories
* generated IIIF presentation JSON for use with UniversalViewer or Mirador
it uses
* https://iiif.io/api/presentation/2.1/
* https://www.openjpeg.org/ and
* https://nodejs.org/en

This is an alpine based image.

This service is meant to be used with a corresponding iipsrv (or similar) server which serves images according to IIIF image API in /iiif/images.

## Checking copied scans

md5sum output files in a IMAGE_MD5_CHECKSUMS_FILES trigger a check
TBD: How to view, how to report errors

## Converting scans

Browsing the /images url you can see the scans on the servers IMAGE_DATA_PATH. Hiting the Convert button converts all scans in IMAGE_DATA_PATH and stores JPEG2000 and pyramid TIFF files in JP2_DATA_PATH. The directory structure is mirrored.

## Metadata to access the images

Using IMAGE_DATA_PATH {collection name}.json and the directory structure (in JP2_DATA_PATH) IIIF presentation metadata is generated in /iiif/presentation/* so Mirador can view the images.
* There is a collection with the filename of the config file
* The collection contains links to one manifest per subfoilder
* The manifests contain all the image paths for one subfolder in the only sequence[0] and
* they contain structures that correpond to the subfolders subfolder (used for an index)

## Memcache access

There is a kind of debugging service to read and write memcache