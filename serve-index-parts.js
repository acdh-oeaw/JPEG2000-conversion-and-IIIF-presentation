/*!
 * serve-index
 * Copyright(c) 2011 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const debug = require('debug')('serve-index');

module.exports.iconLookup = iconLookup;
module.exports.iconStyle = iconStyle;

 /**
 * Get the icon data for the file name.
 */

 function iconLookup(filename) {
    var ext = path.extname(filename);
  
    // try by extension
    if (icons[ext]) {
      return {
        className: 'icon-' + ext.substring(1),
        fileName: icons[ext]
      };
    }
  
    var mimetype = mime.lookup(ext);
  
    // default if no mime type
    if (mimetype === false) {
      return {
        className: 'icon-default',
        fileName: icons.default
      };
    }
  
    // try by mime type
    if (icons[mimetype]) {
      return {
        className: 'icon-' + mimetype.replace('/', '-'),
        fileName: icons[mimetype]
      };
    }
  
    var suffix = mimetype.split('+')[1];
  
    if (suffix && icons['+' + suffix]) {
      return {
        className: 'icon-' + suffix,
        fileName: icons['+' + suffix]
      };
    }
  
    var type = mimetype.split('/')[0];
  
    // try by type only
    if (icons[type]) {
      return {
        className: 'icon-' + type,
        fileName: icons[type]
      };
    }
  
    return {
      className: 'icon-default',
      fileName: icons.default
    };
  }
  
/**
 * Load icon images, return css string.
 */
  
function iconStyle(files, useIcons) {
    if (!useIcons) return '';
    var i;
    var list = [];
    var rules = {};
    var selector;
    var selectors = {};
    var style = '';
  
    for (i = 0; i < files.length; i++) {
      var file = files[i];
  
      var isDir = file.stat && file.stat.isDirectory();
      var icon = isDir
        ? { className: 'icon-directory', fileName: icons.folder }
        : iconLookup(file.name);
      var iconName = icon.fileName;
  
      selector = '#files .' + icon.className + ' .name';
  
      if (!rules[iconName]) {
        rules[iconName] = 'background-image: url(data:image/png;base64,' + load(iconName) + ');'
        selectors[iconName] = [];
        list.push(iconName);
      }
  
      if (selectors[iconName].indexOf(selector) === -1) {
        selectors[iconName].push(selector);
      }
    }
  
    for (i = 0; i < list.length; i++) {
      iconName = list[i];
      style += selectors[iconName].join(',\n') + ' {\n  ' + rules[iconName] + '\n}\n';
    }
  
    return style;
  }
  /*!
   * Icon cache.
   */

  var cache = {};  
  /**
   * Load and cache the given `icon`.
   *
   * @param {String} icon
   * @return {String}
   * @api private
   */
  
  function load(icon) {
    if (cache[icon]) return cache[icon];
    return cache[icon] = fs.readFileSync(__dirname + '/public/icons/' + icon, 'base64');
  }

/**
 * Icon map.
 */

var icons = {
    // base icons
    'default': 'page_white.png',
    'folder': 'folder.png',
  
    // generic mime type icons
    'image': 'image.png',
    'text': 'page_white_text.png',
    'video': 'film.png',
  
    // generic mime suffix icons
    '+json': 'page_white_code.png',
    '+xml': 'page_white_code.png',
    '+zip': 'box.png',
  
    // specific mime type icons
    'application/font-woff': 'font.png',
    'application/javascript': 'page_white_code_red.png',
    'application/json': 'page_white_code.png',
    'application/msword': 'page_white_word.png',
    'application/pdf': 'page_white_acrobat.png',
    'application/postscript': 'page_white_vector.png',
    'application/rtf': 'page_white_word.png',
    'application/vnd.ms-excel': 'page_white_excel.png',
    'application/vnd.ms-powerpoint': 'page_white_powerpoint.png',
    'application/vnd.oasis.opendocument.presentation': 'page_white_powerpoint.png',
    'application/vnd.oasis.opendocument.spreadsheet': 'page_white_excel.png',
    'application/vnd.oasis.opendocument.text': 'page_white_word.png',
    'application/x-7z-compressed': 'box.png',
    'application/x-sh': 'application_xp_terminal.png',
    'application/x-font-ttf': 'font.png',
    'application/x-msaccess': 'page_white_database.png',
    'application/x-shockwave-flash': 'page_white_flash.png',
    'application/x-sql': 'page_white_database.png',
    'application/x-tar': 'box.png',
    'application/x-xz': 'box.png',
    'application/xml': 'page_white_code.png',
    'application/zip': 'box.png',
    'image/svg+xml': 'page_white_vector.png',
    'text/css': 'page_white_code.png',
    'text/html': 'page_white_code.png',
    'text/less': 'page_white_code.png',
  
    // other, extension-specific icons
    '.accdb': 'page_white_database.png',
    '.apk': 'box.png',
    '.app': 'application_xp.png',
    '.as': 'page_white_actionscript.png',
    '.asp': 'page_white_code.png',
    '.aspx': 'page_white_code.png',
    '.bat': 'application_xp_terminal.png',
    '.bz2': 'box.png',
    '.c': 'page_white_c.png',
    '.cab': 'box.png',
    '.cfm': 'page_white_coldfusion.png',
    '.clj': 'page_white_code.png',
    '.cc': 'page_white_cplusplus.png',
    '.cgi': 'application_xp_terminal.png',
    '.cpp': 'page_white_cplusplus.png',
    '.cs': 'page_white_csharp.png',
    '.db': 'page_white_database.png',
    '.dbf': 'page_white_database.png',
    '.deb': 'box.png',
    '.dll': 'page_white_gear.png',
    '.dmg': 'drive.png',
    '.docx': 'page_white_word.png',
    '.erb': 'page_white_ruby.png',
    '.exe': 'application_xp.png',
    '.fnt': 'font.png',
    '.gam': 'controller.png',
    '.gz': 'box.png',
    '.h': 'page_white_h.png',
    '.ini': 'page_white_gear.png',
    '.iso': 'cd.png',
    '.jar': 'box.png',
    '.java': 'page_white_cup.png',
    '.jsp': 'page_white_cup.png',
    '.lua': 'page_white_code.png',
    '.lz': 'box.png',
    '.lzma': 'box.png',
    '.m': 'page_white_code.png',
    '.map': 'map.png',
    '.msi': 'box.png',
    '.mv4': 'film.png',
    '.otf': 'font.png',
    '.pdb': 'page_white_database.png',
    '.php': 'page_white_php.png',
    '.pl': 'page_white_code.png',
    '.pkg': 'box.png',
    '.pptx': 'page_white_powerpoint.png',
    '.psd': 'page_white_picture.png',
    '.py': 'page_white_code.png',
    '.rar': 'box.png',
    '.rb': 'page_white_ruby.png',
    '.rm': 'film.png',
    '.rom': 'controller.png',
    '.rpm': 'box.png',
    '.sass': 'page_white_code.png',
    '.sav': 'controller.png',
    '.scss': 'page_white_code.png',
    '.srt': 'page_white_text.png',
    '.tbz2': 'box.png',
    '.tgz': 'box.png',
    '.tlz': 'box.png',
    '.vb': 'page_white_code.png',
    '.vbs': 'page_white_code.png',
    '.xcf': 'page_white_picture.png',
    '.xlsx': 'page_white_excel.png',
    '.yaws': 'page_white_code.png'
  };