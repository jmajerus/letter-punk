(function (global) {
  'use strict';

  var NODE_SEP = ';';
  var STRING_SEP = ',';
  var TERMINAL_PREFIX = '!';
  var MIN_LETTER = 'a';
  var MAX_LETTER = 'z';
  var MAX_WORD = new Array(10).join(MAX_LETTER);
  var reNodePart = new RegExp('([' + MIN_LETTER + '-' + MAX_LETTER + ']+)(' + STRING_SEP + '|[0-9A-Z]+|$)', 'g');
  var reSymbol = new RegExp('([0-9A-Z]+):([0-9A-Z]+)');
  var BASE = 36;

  function toAlphaCode(n) {
    var s = '';
    var places = 1;
    for (var range = BASE; n >= range; n -= range, places += 1, range *= BASE) {}
    while (places--) {
      var d = n % BASE;
      s = String.fromCharCode((d < 10 ? 48 : 55) + d) + s;
      n = (n - d) / BASE;
    }
    return s;
  }

  function fromAlphaCode(s) {
    var n = 0;
    for (var places = 1, range = BASE; places < s.length; n += range, places += 1, range *= BASE) {}
    for (var i = s.length - 1, pow = 1; i >= 0; i -= 1, pow *= BASE) {
      var d = s.charCodeAt(i) - 48;
      if (d > 10) {
        d -= 7;
      }
      n += d * pow;
    }
    return n;
  }

  function PTrie(packed) {
    this.syms = [];
    this.nodes = packed.split(NODE_SEP);
    this.symCount = 0;

    while (true) {
      var m = reSymbol.exec(this.nodes[this.symCount]);
      if (!m) {
        break;
      }
      if (fromAlphaCode(m[1]) !== this.symCount) {
        throw new Error('Invalid Symbol name - found ' + m[1] + ' when expecting ' + toAlphaCode(this.symCount));
      }
      this.syms[this.symCount] = fromAlphaCode(m[2]);
      this.symCount += 1;
    }

    this.nodes.splice(0, this.symCount);
  }

  PTrie.prototype.isWord = function (word) {
    if (word === '') {
      return false;
    }
    return this.match(word) === word;
  };

  PTrie.prototype.match = function (word) {
    var matches = this.matches(word);
    if (matches.length === 0) {
      return '';
    }
    return matches[matches.length - 1];
  };

  PTrie.prototype.matches = function (word) {
    return this.words(word, word + MIN_LETTER);
  };

  PTrie.prototype.completions = function (prefix, limit) {
    return this.words(prefix, beyond(prefix), limit);
  };

  PTrie.prototype.words = function (from, beyondWord, limit) {
    var words = [];
    function catchWords(word, ctx) {
      if (limit !== undefined && words.length >= limit) {
        ctx.abort = true;
        return;
      }
      words.push(word);
    }
    this.enumerate(0, '', {
      from: from,
      beyond: beyondWord,
      fn: catchWords,
      prefixes: (from + MIN_LETTER) === beyondWord,
    });
    return words;
  };

  PTrie.prototype.enumerate = function (inode, prefix, ctx) {
    var node = this.nodes[inode];
    var self = this;

    function emit(word) {
      if (ctx.prefixes) {
        if (word === ctx.from.slice(0, word.length)) {
          ctx.fn(word, ctx);
        }
        return;
      }
      if (ctx.from <= word && word < ctx.beyond) {
        ctx.fn(word, ctx);
      }
    }

    if (node[0] === TERMINAL_PREFIX) {
      emit(prefix);
      if (ctx.abort) {
        return;
      }
      node = node.slice(1);
    }

    node.replace(reNodePart, function (w, str, ref) {
      var match = prefix + str;
      if (ctx.abort || match >= ctx.beyond || match < ctx.from.slice(0, match.length)) {
        return '';
      }
      var isTerminal = ref === STRING_SEP || ref === '';
      if (isTerminal) {
        emit(match);
        return '';
      }
      self.enumerate(self.inodeFromRef(ref, inode), match, ctx);
      return '';
    });
  };

  PTrie.prototype.inodeFromRef = function (ref, inodeFrom) {
    var dnode = fromAlphaCode(ref);
    if (dnode < this.symCount) {
      return this.syms[dnode];
    }
    dnode -= this.symCount;
    return inodeFrom + dnode + 1;
  };

  function beyond(s) {
    if (s.length === 0) {
      return MAX_WORD;
    }
    var code = s.charCodeAt(s.length - 1);
    return s.slice(0, -1) + String.fromCharCode(code + 1);
  }

  global.DawgLookup = {
    PTrie: PTrie,
  };
}(typeof window !== 'undefined' ? window : self));
