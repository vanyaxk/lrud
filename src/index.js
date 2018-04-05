var EventEmitter = require('tiny-emitter')
var KeyCodes = require('./key-codes')

var either = function (arg, a, b) { return arg === a || arg === b }
var isList = function (node) { return node && !!node.orientation }

function assign (target) {
  for (var i = 1; i < arguments.length; i++) {
    var subject = Object(arguments[i])
    for (var prop in subject) {
      if (subject.hasOwnProperty(prop)) {
        target[prop] = subject[prop]
      }
    }
  }
  return target
}

function isValidLRUDEvent (event, node) {
  return (
    node.orientation === 'horizontal' && either(
      Lrud.KEY_CODES[event.keyCode],
      Lrud.KEY_MAP.LEFT,
      Lrud.KEY_MAP.RIGHT
    )
  ) || (
    node.orientation === 'vertical' && either(
      Lrud.KEY_CODES[event.keyCode],
      Lrud.KEY_MAP.UP,
      Lrud.KEY_MAP.DOWN
    )
  )
}

function Lrud () {
  this.nodes = {}
  this.root = null
  this.currentFocus = null
}

Lrud.prototype = Object.create(EventEmitter.prototype)

assign(Lrud.prototype, {
  register: function (id, props) {
    if (!id) throw new Error('Attempting to register with an invalid id')

    var node = this._createNode(id, props)

    if (node.parent) {
      var parentNode = this._createNode(node.parent)

      if (parentNode.children.indexOf(id) === -1) {
        parentNode.children.push(id)
      }

      this.nodes[node.parent] = parentNode
    } else {
      this.root = id
    }

    this.nodes[id] = node
  },

  unregister: function (id) {
    var node = this.nodes[id]
    if (!node) return

    var parentNode = this.nodes[node.parent]

    if (parentNode) {
      parentNode.children = parentNode.children.filter(function (cid) {
        return cid !== id
      })

      if (parentNode.activeChild === id) {
        parentNode.activeChild = undefined
      }
    }

    if (this.currentFocus === id) {
      this.blur()
      this.currentFocus = undefined
    }

    delete this.nodes[id]
    node.children.forEach(this.unregister.bind(this))
  },

  blur: function (id) {
    var node = this.nodes[id] || this.nodes[this.currentFocus]
    if (!node) return

    var clone = assign({}, node)

    if (node.onBlur) {
      node.onBlur(clone)
    }

    this.emit('blur', clone)
  },

  focus: function (id) {
    var node = this.nodes[id] || this.nodes[this.currentFocus] || this.nodes[this.root]
    if (!node) return

    var activeChild = this._getActiveChild(node)
    if (activeChild) {
      return this.focus(activeChild)
    }

    this.blur()

    var clone = assign({}, node)

    if (node.onFocus) {
      node.onFocus(clone)
    }

    this.emit('focus', clone)

    this._bubbleActive(node.id)
    this.currentFocus = node.id
  },

  handleKeyEvent: function (event) {
    this._bubbleKeyEvent(event, this.currentFocus)
  },

  destroy: function () {
    this.e = {}
    this.nodes = {}
    this.root = null
    this.currentFocus = null
  },

  setActiveChild: function (id, child) {
    var node = this.nodes[id]
    var childNode = this.nodes[child]

    if (!node || node.children.indexOf(child) === -1 || !childNode || childNode.disabled) {
      return
    }

    if (node.activeChild !== child) {
      if (node.activeChild) {
        this.emit('inactive', assign({}, this.nodes[node.activeChild]))
      }

      this.emit('active', assign({}, this.nodes[child]))
      node.activeChild = child
    }
  },

  setActiveIndex: function (id, index) {
    var node = this.nodes[id]
    if (!node || !node.children[index]) return

    this.setActiveChild(id, node.children[index])
  },

  getNodeById: function (id) {
    return this.nodes[id]
  },

  getFocusedNode: function () {
    return this.nodes[this.currentFocus]
  },

  // Search down the active brach of the tree only...
  searchDown: function (node, predicate) {
    var id = this._getActiveChild(node)
    var child = this.nodes[id]

    if (child && !predicate(child)) {
      return this.searchDown(child, predicate)
    }

    return child
  },

  searchUp: function (node, predicate) {
    var parent = this.nodes[node.parent]

    if (parent && !predicate(parent)) {
      return this.searchUp(parent, predicate)
    }

    return parent
  },

  _createNode: function (id, props) {
    return assign({ id: id, children: [] }, this.nodes[id], props)
  },

  _updateGrid: function (grid) {
    var row = this.searchDown(grid, isList)
    if (!row) return

    var activeChild = this._getActiveChild(row)
    var activeIndex = row.children.indexOf(activeChild)

    grid.children.forEach(function (id) {
      var parent = this.nodes[id]
      var child = !isList(parent) ? this.searchDown(parent, isList) : parent
      if (!child) return

      this.setActiveIndex(child.id, Math.min(
        child.children.length - 1,
        activeIndex
      ))
    }.bind(this))
  },

  _getActiveChild: function (node) {
    return node.activeChild || node.children.filter(function (id) {
      return !this.nodes[id].disabled
    }.bind(this))[0]
  },

  _getNextActiveIndex: function (node, offset, index) {
    var currIndex = index + offset
    var listSize = node.children.length
    var nextIndex = node.wrapping ? (currIndex + listSize) % listSize : currIndex
    var targetId = node.children[nextIndex]
    var target = this.nodes[targetId]

    // Skip if this node is disabled
    if (target && target.disabled) {
      return this._getNextActiveIndex(node, offset, nextIndex)
    }

    return nextIndex
  },

  _bubbleKeyEvent: function (event, id) {
    var node = this.nodes[id]
    if (!node) return

    var key = Lrud.KEY_CODES[event.keyCode]

    if (key === Lrud.KEY_MAP.ENTER) {
      var clone = assign({}, node)

      if (node.onSelect) {
        node.onSelect(clone)
      }

      this.emit('select', clone)
      return
    }

    if (isValidLRUDEvent(event, node)) {
      var activeChild = this._getActiveChild(node)
      var activeIndex = node.children.indexOf(activeChild)
      var offset = either(key, Lrud.KEY_MAP.RIGHT, Lrud.KEY_MAP.DOWN) ? 1 : -1
      var nextActiveIndex = this._getNextActiveIndex(node, offset, activeIndex)
      var nextActiveChild = node.children[nextActiveIndex]

      if (nextActiveChild) {
        if (node.grid) {
          this._updateGrid(node)
        }

        var moveEvent = assign({}, node, {
          offset: offset,
          enter: {
            id: nextActiveChild,
            index: nextActiveIndex
          },
          leave: {
            id: activeChild,
            index: activeIndex
          }
        })

        if (node.onMove) {
          node.onMove(moveEvent)
        }

        this.emit('move', moveEvent)

        this.focus(nextActiveChild)
        event.stopPropagation()
        return
      }
    }

    this._bubbleKeyEvent(event, node.parent)
  },

  _bubbleActive: function (id) {
    var node = this.nodes[id]

    if (node.parent) {
      this.setActiveChild(node.parent, id)
      this._bubbleActive(node.parent)
    }
  }
})

Lrud.KEY_MAP = KeyCodes.map
Lrud.KEY_CODES = KeyCodes.codes

module.exports = Lrud
