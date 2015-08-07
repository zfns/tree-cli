'use strict';

var _DEBUG = false;

var Promise = require('bluebird'),
	assign = require('object-assign'),
	chalk = require('chalk'),
	Spinner = require('cli-spinner').Spinner,

	fs = Promise.promisifyAll(require('fs')),
	os = require('os'),
	path = require('path'),
	childProcess = require('child_process'),

	DEFAULT_LEVEL = 1,
	DEFAULT_INDENT = 2,

	_LOG_DEBUG = '[debug]',
	_LOG = chalk.bold.green('[log]'),
	_ERROR = chalk.bold.red('[error]'),

	_root,
	_spinner = new Spinner(),

	// init configure. pass from prompt arguments or parameter of run.
	_flags = {
		// --debug
		// show debug info.
		debug: _DEBUG,
		base: '.',
		indent: DEFAULT_INDENT,
		// --fullpath
		// prints the full path prefix for each file.
		fullpath: false,
		// --noreport
		// omits printing of the file and directory report at the end of
		// the tree listing and omits printing the tree on console.
		noreport: false,
		// -l
		// max display depth of the directory tree.
		l: DEFAULT_LEVEL,
		o: 'tree_out',
		// -f
		// append a '/' for directories, a '=' for socket files
    // and a '|' for FIFOs
		f: false,
	},

	_tree = {
	},

	_stats = {
		all: [],
		file: [],
		directory: [],
		blockdevice: [],
		characterdevice: [],
		symboliclink: [],
		fifo: [],
		socket: []
	},

	_types = [
		'directory',
		'file',
		'blockdevice',
		'characterdevice',
		'symboliclink',
		'fifo',
		'socket',
	],

	_marks,

	// backup marks: ├── └──

	_genMarks = function() {
		_marks = {
			vert: '|',
			hori: '-',
			eol: os.EOL,
			pre_blank: _flags.i ?
				'' :
				'|' + new Array(_flags.indent + 1).join(' '),
			pre_file: _flags.i ?
				'' :
				'|' + new Array(_flags.indent + 1).join('-'),
			last_file: _flags.i ?
				'' :
				'`' + new Array(_flags.indent + 1).join('-'),
			pre_directory: _flags.f ? '/' : '',
			pre_blockdevice: '',
			pre_characterdevice: '',
			pre_symboliclink: '>',
			pre_socket: _flags.f ? '=' : '',
			pre_fifo: _flags.f ? '|' : ''
		}
	},

	_spinnerOn = function() {
		_spinner.setSpinnerString(9);
		_spinner.start();
	},

	_spinnerOff = function() {
		_spinner.stop(true);
	},

	_debug = function() {
		if (_flags.debug) {
			console.log.apply(this,
				[_LOG_DEBUG].concat(Array.prototype.slice.call(arguments)));
		}
	},

	_log = function() {
		console.error.apply(this,
			[_LOG].concat(Array.prototype.slice.call(arguments)));
	},

	_error = function() {
		console.error.apply(this,
			[_ERROR].concat(Array.prototype.slice.call(arguments)));
	},

	exec = function(cmd) {
		return Promise.promisify(childProcess.exec)(cmd)
			.then(function(res) {
				_debug('exec: ', cmd);
				_debug('exec res: ', res);
				return res;
			}).catch(function(err) {
				_error(err);
				process.exit(-1);
			});
	},

	init = function(flags) {

		assign(_flags, flags);
		if (_flags.l < DEFAULT_LEVEL) {
			_flags.l = DEFAULT_LEVEL;
		}
		_log('flags', _flags);
		_genMarks();

		_spinnerOn();
		return getRoot();

	},

	getRoot = function() {

		if (_root) {
			return Promise.resolve(_root);
		} else {
			return exec('pwd').then(function(res) {
				_root = res[0].split('\n')[0];
				_debug('__dirname:', __dirname);
				_debug('root:', _root);
				return _root;
			});
		}

	},

	getFileType = function(path) {

		return fs.lstatAsync(path)
			.then(function(stats) {
				var types = [
					'Directory',
					'File',
					'BlockDevice',
					'CharacterDevice',
					'SymbolicLink',
					'FIFO',
					'Socket',
				], type;
				for (var i = 0, l = types.length; i < l; i++) {
					type = types[i];
					if (stats['is' + type]()) {
						_debug(type, path);
						return type.toLowerCase();
					}
				}
			})
			.catch(function(err) {
				_error(err);
				process.exit(-1);
			});

	},

	isDirectory = function(path) {

		return fs.lstatAsync(path)
			.then(function(stats) {
				return stats.isDirectory();
			})
			.catch(function(err) {
				_error(err);
				process.exit(-1);
			});

	},

	appendChildNodes = function(parent) {

		_debug('appendTreeNode:', parent);
		if (parent.level >= _flags.l) {
			return;
		}
		if (!parent.path) {
			_error('Path must exists:', parent);
			process.exit(-1);
		}
		if (parent.type !== 'directory') {
			_error('Must be a directory:', parent);
			process.exit(-1);
		}
		parent.children = [];
		return fs.readdirAsync(parent.path)
			.then(function(files) {
				return Promise.resolve(files)
					.each(function(file) {
						var filePath = path.resolve(parent.path, file),
							ignoreReg = /^\./;
						if (!_flags.a && ignoreReg.test(file)) {
							return;
						}
						return getFileType(filePath).then(function(type) {
							_debug(type, filePath);
							var child = {
								type: type,
								level: parent.level + 1,
								name: file,
								path: filePath
							};
							parent.children.push(child);
							// for statistics.
							_stats.all.push(child);
							_stats[type].push(child);
							if (type === 'directory') {
								return appendChildNodes(child);
							}
						})
					});
			})
			.catch(function(err) {
				_error(err);
				process.exit(-1);
			});;
		
	},

	genTree = function(rootPath) {

		_debug('- genTree started...');
		
		// rootPath must be a direcotry.
		return isDirectory(rootPath).then(function(yes) {
			if (!yes) {
				console.error('Root path must be a direcotry:', rootPath);
				process.exit(-1);
			}
			_tree.root = {
				type: 'directory',
				level: 0,
				name: path.basename(rootPath),
				path: rootPath
			};
			return appendChildNodes(_tree.root);
		}).then(function() {
			_debug('- genTree done.');
		});

	},

	_stringifyTreeNode =  function(node, last) {

		var children = node.children, lastChild,
			str = '';
		for (i = 0; i < node.level - 1; i++) {
			str += _marks.pre_blank;
		}
		if (last) {
			str += _marks.last_file;
		} else {
			str += _marks.pre_file;
		}
		if (node.type !== 'file') {
			str += _marks['pre_' + node.type];
		}
		str += ' ' +
			(_flags.fullpath ? node.path : node.name) +
			_marks.eol;
		if (node.type !== 'directory' || !children) {
			return str;
		}
		for (var i = 0, l = children.length; i < l; i++) {
			(i === l - 1) && (lastChild = true);
			str += _stringifyTreeNode(children[i], lastChild);
		}
		return str;

	},

	stringifyTree = function(tree) {

		var root = tree.root,
			str = root.path + _marks.eol,
			children = root.children,
			last,
			all = _stats.all;

		for (var i = 0, l = children.length; i < l; i++) {
			(i === l - 1) && (last = true);
			str += _stringifyTreeNode(children[i], last);
		}
		return str;

	},

	make = function(flags) {

		init(flags)
			.then(function() {
				var rootPath = path.resolve(_root, _flags.base);
				return genTree(rootPath);
			})
			.then(function() {
				_debug('generated tree:', JSON.stringify(_tree, null, 2));
				var str = stringifyTree(_tree) + _marks.eol;
				if (!_flags.noreport) {
					for (var i = 0, l = _types.length; i < l; i++) {
						if (_stats[_types[i]] && _stats[_types[i]].length) {
							str += _types[i] + ': ' + _stats[_types[i]].length + ' ';
						}
					}
					_log('result:\n', str);
				}
				return fs.writeFileAsync(_flags.o, str)
					.then(function() {
						_log('Finish writing to file:',
							path.resolve(_root, _flags.o)
						);
					})
					.catch(function(err) {
						_error(err);
						process.exit(-1);
					});
			})
			.then(function() {
				_spinnerOff();
			});

	};

module.exports = {

	make: make

};
