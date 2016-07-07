'use strict';

// Libs
import * as _ from 'lodash';
import * as cuid from 'cuid';
import { EventEmitter2 } from 'eventemitter2';
import { Promise } from 'es6-promise';
import { TreeNode } from './treenode';
import { TreeNodes } from './treenodes';

// CSS
require('./scss/tree.scss');

var noop = function() {};

export default class InspireTree extends EventEmitter2 {
    _lastSelectedNode: TreeNode;
    _muted: any = false;

    allowsLoadEvents: boolean = false;
    config: any;
    defaultState: any = {
        collapsed: true,
        focused: false,
        hidden: false,
        indeterminate: false,
        loading: false,
        removed: false,
        selectable: true,
        selected: false
    };
    dom: any;
    initialized: boolean = false;
    isDynamic: boolean = false;
    model: TreeNodes;
    opts: any;
    preventDeselection: boolean = false;

    constructor(opts: any) {
        super();

        var tree = this;
        tree.model = new TreeNodes(tree);
        tree.opts = opts;

        if (!opts.data) {
            throw new TypeError('Invalid data loader.');
        }

        // Assign defaults
        tree.config = _.defaultsDeep({}, opts, {
            allowLoadEvents: [],
            contextMenu: false,
            dragTargets: false,
            nodes: {
                resetStateOnRestore: true
            },
            renderer: false,
            search: false,
            selection: {
                allow: noop,
                autoDeselect: true,
                autoSelectChildren: false,
                disableDirectDeselection: false,
                mode: 'default',
                multiple: false,
                require: false
            },
            showCheckboxes: false,
            sort: false,
            tabindex: -1
        });

        // If checkbox mode, we must force auto-selecting children
        if (tree.config.selection.mode === 'checkbox') {
            tree.config.selection.autoSelectChildren = true;
            tree.config.selection.autoDeselect = false;

            if (!_.isBoolean(opts.showCheckboxes)) {
                tree.config.showCheckboxes = true;
            }
        }

        // If auto-selecting children, we must force multiselect
        if (tree.config.selection.autoSelectChildren) {
            tree.config.selection.multiple = true;
        }

        // Cache some configs
        tree.allowsLoadEvents = _.isArray(tree.config.allowLoadEvents) && tree.config.allowLoadEvents.length > 0;
        tree.isDynamic = _.isFunction(tree.config.data);

        // Override emitter so we can better control flow
        var emit = tree.emit;
        tree.emit = function() {
            if (!tree.muted()) {
                // Duck-type for a DOM event
                if (_.isFunction(_.get(arguments, '[1].preventDefault'))) {
                    var event = arguments[1];
                    event.treeDefaultPrevented = false;
                    event.preventTreeDefault = function() {
                        event.treeDefaultPrevented = true;
                    };
                }

                emit.apply(tree, arguments);
            }
        };

        // Webpack has a DOM boolean that when false,
        // allows us to exclude this library from our build.
        // For those doing their own rendering, it's useless.
        if (DOM) {
            tree.dom = new (require('./dom'))(tree);
        }

        // Validation
        if (tree.dom && (!_.isObject(opts) || !opts.target)) {
            throw new TypeError('Property "target" is required, either an element or a selector.');
        }

        // Load custom/empty renderer
        if (!tree.dom) {
            var renderer = _.isFunction(tree.config.renderer) ? tree.config.renderer(tree) : {};
            tree.dom = _.defaults(renderer, {
                applyChanges: noop,
                attach: noop,
                batch: noop,
                end: noop
            });
        }

        // Connect to our target DOM element
        tree.dom.attach(tree.config.target);

        // Load initial user data
        tree.load(tree.config.data);

        tree.initialized = true;
    }

    /**
     * Adds a new node to this collection. If a sort
     * method is configured, the node will be added
     * in the appropriate order.
     *
     * @category Tree
     * @param {object} object Node
     * @return {TreeNode} Node object.
     */
    addNode(node: TreeNode) {
        return this.model.addNode.apply(this.model, arguments);
    }

    /**
     * Add nodes.
     *
     * @category Tree
     * @param {array} nodes Array of node objects.
     * @return {TreeNodes} Added node objects.
     */
    addNodes(nodes) {
        var tree = this;
        tree.dom.batch();

        var newNodes = new TreeNodes(this);
        _.each(nodes, function(node) {
            newNodes.push(tree.addNode(node));
        });

        tree.dom.end();

        return newNodes;
    }

    /**
     * Query for all available nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    available() {
        return this.model.available.apply(this.model, arguments);
    }

    /**
     * Invoke given method(s) on tree nodes.
     *
     * @private
     * @param {TreeNodes} nodes Array of node objects.
     * @param {string|array} methods Method names.
     * @param {boolean} deep Invoke deeply.
     * @return {TreeNodes} Array of node objects.
     */
    baseInvoke(nodes: TreeNodes, methods: string | Array<string>, deep?: boolean) {
        methods = _.castArray(methods);

        this.dom.batch();

        nodes[deep ? 'recurseDown' : 'each'](function(node) {
            _.each(methods, function(method) {
                if (_.isFunction(node[method])) {
                    node[method]();
                }
            });
        });

        this.dom.end();

        return nodes;
    }

    /**
     * Stores repetitive state change logic for most state methods.
     *
     * @private
     * @param {string} prop State property name.
     * @param {boolean} value New state value.
     * @param {string} verb Verb used for events.
     * @param {TreeNode} node Node object.
     * @param {string} deep Optional name of state method to call recursively.
     * @return {TreeNode} Node object.
     */
    baseStateChange(prop: string, value: boolean, verb: string, node: TreeNode, deep?: string) {
        if (node.state(prop) !== value) {
            if (this.config.nodes.resetStateOnRestore && verb === 'restored') {
                this.resetState(node);
            }

            node.state(prop, value);

            this.emit('node.' + verb, node);

            if (deep && node.hasChildren()) {
                node.getChildren().invokeDeep(deep);
            }

            node.markDirty();
            this.dom.applyChanges();
        }

        return node;
    }

    /**
     * Blur children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    blur() {
        return this.model.blur.apply(this.model, arguments);
    }

    /**
     * Blur all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    blurDeep() {
        return this.model.blurDeep.apply(this.model, arguments);
    }

    /**
     * Compares any number of TreeNode objects and returns
     * the minimum and maximum (starting/ending) nodes.
     *
     * @category Tree
     * @return {array} Array with two TreeNode objects.
     */
    boundingNodes(...args : Array<TreeNode>) {
        // cast to an array because typescript complains IArguments isn't accepted by lodash
        // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/10015
        var args: Array<TreeNode> = Array.prototype.slice.call(arguments);
        var pathMap = _.transform(args, function(map, node) {
            map[(<TreeNode> node).indexPath().replace(/\./g, '')] = node;
        }, {});

        var paths = _.sortBy(Object.keys(pathMap));
        return [
            _.get(pathMap, _.head(paths)),
            _.get(pathMap, _.tail(paths))
        ];
    }

    /**
     * Get if the tree will auto-deselect currently selected nodes
     * when a new selection is made.
     *
     * @category Tree
     * @return {boolean} If tree will auto-deselect nodes.
     */
    canAutoDeselect() {
        return this.config.selection.autoDeselect && !this.preventDeselection;
    }

    /**
     * Clean children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    clean() {
        return this.model.clean.apply(this.model, arguments);
    }

    /**
     * Shows all nodes and collapses parents.
     *
     * @category Tree
     * @return {Tree} Tree instance.
     */
    clearSearch() {
        return this.showDeep().collapseDeep().tree();
    }

    /**
     * Clones (deep) the array of nodes.
     *
     * Note: Cloning will *not* clone the context pointer.
     *
     * @category Tree
     * @return {TreeNodes} Array of cloned nodes.
     */
    clone() {
        return this.model.clone.apply(this.model, arguments);
    }

    /**
     * Collapse children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    collapse() {
        return this.model.collapse.apply(this.model, arguments);
    }

    /**
     * Query for all collapsed nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    collapsed() {
        return this.model.collapsed.apply(this.model, arguments);
    }

    /**
     * Collapse all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    collapseDeep() {
        return this.model.collapseDeep.apply(this.model, arguments);
    }

    /**
     * Parses a raw collection of objects into a model used
     * within a tree. Adds state and other internal properties.
     *
     * @private
     * @param {array} array Array of nodes
     * @param {object} parent Pointer to parent object
     * @return {array|object} Object model.
     */
    collectionToModel(array: TreeNodes, parent?: TreeNode) {
        var tree = this;
        var collection = new TreeNodes(tree);

        // Sort
        if (tree.config.sort) {
            array = <TreeNodes> _.sortBy(array, tree.config.sort);
        }

        _.each(array, function(node) {
            collection.push(tree.objectToModel(node, parent));
        });

        collection._context = parent;

        return collection;
    };

    /**
     * Concat nodes like an Array would.
     *
     * @category Tree
     * @param {TreeNodes} nodes Array of nodes.
     * @return {TreeNodes} Resulting node array.
     */
    concat() {
        return this.model.concat.apply(this.model, arguments);
    }

    /**
     * Copies nodes to a new tree instance.
     *
     * @category Tree
     * @param {boolean} hierarchy Include necessary ancestors to match hierarchy.
     * @return {object} Methods to perform action on copied nodes.
     */
    copy() {
        return this.model.copy.apply(this.model, arguments);
    }

    /**
     * Returns deepest nodes from this array.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    deepest() {
        return this.model.deepest.apply(this.model, arguments);
    }

    /**
     * Deselect children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    deselect() {
        return this.model.deselect.apply(this.model, arguments);
    }

    /**
     * Deselect all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    deselectDeep() {
        return this.model.deselectDeep.apply(this.model, arguments);
    }

    /**
     * Disable auto-deselection of currently selected nodes.
     *
     * @category Tree
     * @return {Tree} Tree instance.
     */
    disableDeselection() {
        if (this.config.selection.multiple) {
            this.preventDeselection = true;
        }

        return this;
    }

    /**
     * Iterate every TreeNode in this collection.
     *
     * @category Tree
     * @param {function} iteratee Iteratee invoke for each node.
     * @return {TreeNodes} Array of node objects.
     */
    each() {
        return this.model.each.apply(this.model, arguments);
    }

    /**
     * Enable auto-deselection of currently selected nodes.
     *
     * @category Tree
     * @return {Tree} Tree instance.
     */
    enableDeselection() {
        this.preventDeselection = false;

        return this;
    }

    /**
     * Expand children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    expand() {
        return this.model.expand.apply(this.model, arguments);
    }

    /**
     * Query for all expanded nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    expandDeep() {
        return this.model.expandDeep.apply(this.model, arguments);
    }

    /**
     * Recursively expands all nodes, loading all dynamic calls.
     *
     * @category Tree
     * @return {Promise} Promise resolved only when all children have loaded and expanded.
     */
    expanded() {
        return this.model.expanded.apply(this.model, arguments);
    }

    /**
     * Clones an array of node objects and removes any
     * itree instance information/state.
     *
     * @category Tree
     * @return {array} Array of node objects.
     */
    export() {
        return this.model.export.apply(this.model, arguments);
    }

    /**
     * Returns a cloned hierarchy of all nodes matching a predicate.
     *
     * Because it filters deeply, we must clone all nodes so that we
     * don't affect the actual node array.
     *
     * @category Tree
     * @param {string|function} predicate State flag or custom function.
     * @return {TreeNodes} Array of node objects.
     */
    extract() {
        return this.model.extract.apply(this.model, arguments);
    }

    /**
     * Returns nodes which match a predicate.
     *
     * @category Tree
     * @param {string|function} predicate State flag or custom function.
     * @return {TreeNodes} Array of node objects.
     */
    filter() {
        return this.model.filter.apply(this.model, arguments);
    }

    /**
     * Flattens a hierarchy, returning only node(s) matching the
     * expected state or predicate function.
     *
     * @category Tree
     * @param {string|function} predicate State property or custom function.
     * @return {TreeNodes} Flat array of matching nodes.
     */
    flatten() {
        return this.model.flatten.apply(this.model, arguments);
    }

    /**
     * Query for all focused nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    focused() {
        return this.model.focused.apply(this.model, arguments);
    }

    /**
     * Get a specific node in the collection, or undefined if it doesn't exist.
     *
     * @category Tree
     * @param {int} index Numeric index of requested node.
     * @return {TreeNode} Node object. Undefined if invalid index.
     */
    get(index) {
        return this.model.get(index);
    }

    /**
     * Creates a predicate function.
     *
     * @private
     * @param {string|function} predicate Property name or custom function.
     * @return {function} Predicate function.
     */
    getPredicateFunction(predicate) {
        var fn = predicate;
        if (_.isString(predicate)) {
            fn = function(node) {
                return _.isFunction(node[predicate]) ? node[predicate]() : node[predicate];
            };
        }

        return fn;
    }

    /**
     * Query for all hidden nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    hidden() {
        return this.model.hidden.apply(this.model, arguments);
    }

    /**
     * Hide children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    hide() {
        return this.model.hide.apply(this.model, arguments);
    }

    /**
     * Hide all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    hideDeep() {
        return this.model.hideDeep.apply(this.model, arguments);
    }

    /**
     * Query for all indeterminate nodes.
     *
     * @category TreeNodes
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    indeterminate() {
        return this.model.indeterminate.apply(this.model, arguments);
    }

    /**
     * Insert a new node at a given position.
     *
     * @category Tree
     * @param {integer} index Index at which to insert the node.
     * @param {object} object Raw node object or TreeNode.
     * @return {TreeNode} Node object.
     */
    insertAt() {
        return this.model.insertAt.apply(this.model, arguments);
    }

    /**
     * Invoke method(s) on each node.
     *
     * @category Tree
     * @param {string|array} methods Method name(s).
     * @return {TreeNodes} Array of node objects.
     */
    invoke() {
        return this.model.invoke.apply(this.model, arguments);
    }

    /**
     * Invoke method(s) deeply.
     *
     * @category Tree
     * @param {string|array} methods Method name(s).
     * @return {TreeNodes} Array of node objects.
     */
    invokeDeep() {
        return this.model.invokeDeep.apply(this.model, arguments);
    }

    /**
     * Check if an object is a TreeNode.
     *
     * @category Tree
     * @param {object} object Object
     * @return {boolean} If object is a TreeNode.
     */
    isNode(object) {
        if (object.constructor) {
            return object.constructor.name === 'TreeNode';
        }

        return false;
    }

    /**
     * Get the most recently selected node, if any.
     *
     * @category Tree
     * @return {TreeNode} Last selected node, or undefined.
     */
    lastSelectedNode() {
        return this._lastSelectedNode;
    }

    /**
     * Loads tree. Accepts an array or a promise.
     *
     * @category Tree
     * @param {array|function} loader Array of nodes, or promise resolving an array of nodes.
     * @return {Promise} Promise resolved upon successful load, rejected on error.
     * @example
     *
     * tree.load($.getJSON('nodes.json'));
     */
    load(loader) {
        var tree = this;

        return new Promise(function(resolve, reject) {
            var complete = function(nodes) {
                // Delay event for synchronous loader. Otherwise it fires
                // before the user has a chance to listen.
                if (!tree.initialized && _.isArray(nodes)) {
                    setTimeout(function() {
                        tree.emit('data.loaded', nodes);
                    });
                }
                else {
                    tree.emit('data.loaded', nodes);
                }

                // Clear and call rendering on existing data
                if (tree.model.length > 0) {
                    tree.removeAll();
                }

                tree.model = tree.collectionToModel(nodes);

                if (tree.config.selection.require && !tree.selected().length) {
                    tree.selectFirstAvailableNode();
                }

                // Delay event for synchronous loader
                if (!tree.initialized && _.isArray(nodes)) {
                    setTimeout(function() {
                        tree.emit('model.loaded', tree.model);
                    });
                }
                else {
                    tree.emit('model.loaded', tree.model);
                }

                resolve(tree.model);

                tree.dom.applyChanges();

                if (_.isFunction(tree.dom.scrollSelectedIntoView)) {
                    tree.dom.scrollSelectedIntoView();
                }
            };

            var error = function(err) {
                tree.emit('data.loaderror', err);
                reject(err);
            };

            // Data given already as an array
            if (_.isArrayLike(loader)) {
                complete(loader);
            }

            // Data loader requires a caller/callback
            else if (_.isFunction(loader)) {
                var resp = loader(null, complete, error);

                // Loader returned its own object
                if (resp) {
                    loader = resp;
                }
            }

            // Data loader is likely a promise
            if (_.isObject(loader)) {
                tree.standardizePromise(loader).then(complete).catch(error);
            }

            else {
                throw new Error('Invalid data loader.');
            }
        });
    }

    /**
     * Query for all loading nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    loading() {
        return this.model.loading.apply(this.model, arguments);
    }

    /*
     * Pause events.
     *
     * @category Tree
     * @param {array} events Event names to mute.
     * @return {Tree} Tree instance.
     */
    mute(events) {
        if (_.isString(events) || _.isArray(events)) {
            this._muted = _.castArray(events);
        }
        else {
            this._muted = true;
        }

        return this;
    }

    /**
     * Get current mute settings.
     *
     * @category Tree
     * @return {boolean|array} Muted events. If all, true.
     */
    muted() {
        return this._muted;
    }

    /**
     * Get a node.
     *
     * @category Tree
     * @param {string|number} id ID of node.
     * @return {TreeNode} Node object.
     */
    node(id: number | string) {
        return this.model.node.apply(this.model, arguments);
    }

    /**
     * Get all nodes in a tree, or nodes for an array of IDs.
     *
     * @category Tree
     * @param {array} refs Array of ID references.
     * @return {TreeNodes} Array of node objects.
     * @example
     *
     * var all = tree.nodes()
     * var some = tree.nodes([1, 2, 3])
     */
    nodes() {
        return this.model.nodes.apply(this.model, arguments);
    }

    /**
     * Parse a raw object into a model used within a tree.
     *
     * Note: Uses native js over lodash where performance
     * benefits most, since this handles every node.
     *
     * @private
     * @param {object} object Source object
     * @param {object} parent Pointer to parent object.
     * @return {object} Final object
     */
    objectToModel(object: any, parent?: TreeNode) {
        var tree = this;

        // Create or type-ensure ID
        object.id = object.id || cuid();
        if (typeof object.id !== 'string') {
            object.id = object.id.toString();
        }

        // High-performance default assignments
        var itree = object.itree = object.itree || {};
        itree.icon = itree.icon || false;

        var li = itree.li = itree.li || {};
        li.attributes = li.attributes || {};

        var a = itree.a = itree.a || {};
        a.attributes = a.attributes || {};

        var state = itree.state = itree.state || {};

        // Enabled by default
        state.collapsed = typeof state.collapsed === 'boolean' ? state.collapsed : tree.defaultState.collapsed;
        state.selectable = typeof state.selectable === 'boolean' ? state.selectable : tree.defaultState.selectable;

        // Disabled by default
        state.focused = state.focused || tree.defaultState.focused;
        state.hidden = state.hidden || tree.defaultState.hidden;
        state.indeterminate = state.indeterminate || tree.defaultState.indeterminate;
        state.loading = state.loading || tree.defaultState.loading;
        state.removed = state.removed || tree.defaultState.removed;
        state.selected = state.selected || tree.defaultState.selected;

        // Save parent, if any.
        object.itree.parent = parent;

        // Wrap
        object = _.assign(new TreeNode(this), object);

        if (object.hasChildren()) {
            object.children = tree.collectionToModel(object.children, object);
        }

        // Fire events for pre-set states, if enabled
        if (tree.allowsLoadEvents) {
            _.each(tree.config.allowLoadEvents, function(eventName) {
                if (state[eventName]) {
                    tree.emit('node.' + eventName, object);
                }
            });
        }

        return object;
    };

    /**
     * Base recursion function for a collection or node.
     *
     * Returns false if execution should cease.
     *
     * @private
     * @param {TreeNode|TreeNodes} obj Node or collection.
     * @param {function} iteratee Iteratee function
     * @return {boolean} Cease iteration.
     */
    recurseDown() {
        return this.model.recurseDown.apply(this.model, arguments);
    }

    /**
     * Reloads/re-executes the original data loader.
     *
     * @category Tree
     * @return {Promise} Load method promise.
     */
    reload() {
        return this.load(this.opts.data || this.config.data);
    }

    /**
     * Removes all nodes.
     *
     * @category Tree
     * @return {Tree} Tree instance.
     */
    removeAll() {
        this.model = new TreeNodes(this);
        this.dom.applyChanges();

        return this;
    }

    /**
     * Query for all soft-removed nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    removed() {
        return this.model.removed.apply(this.model, arguments);
    }

    /**
     * Reset a node's state to the tree default.
     *
     * @private
     * @param {TreeNode} node Node object.
     * @returns {TreeNode} Node object.
     */
    resetState(node: TreeNode) {
        _.each(this.defaultState, function(val, prop) {
            node.state(prop, val);
        });

        return node;
    }

    /**
     * Restore children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    restore() {
        return this.model.restore.apply(this.model, arguments);
    }

    /**
     * Restore all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    restoreDeep() {
        return this.model.restoreDeep.apply(this.model, arguments);
    }

    /**
     * Search nodes, showing only those that match and the necessary hierarchy.
     *
     * @category Tree
     * @param {*} query Search string, RegExp, or function.
     * @return {TreeNodes} Array of matching node objects.
     */
    search(query: any) {
        var tree = this;
        var matches = new TreeNodes(this);

        var custom = tree.config.search;
        if (_.isFunction(custom)) {
            return custom(
                query,
                function resolver(nodes) {
                    tree.dom.batch();

                    tree.hideDeep();
                    _.each(nodes, function(node) {
                        tree.addNode(node);
                    });

                    tree.dom.end();
                },
                function rejecter(err) {
                    tree.emit('tree.loaderror', err);
                }
            );
        }

        // Don't search if query empty
        if (!query || (_.isString(query) && _.isEmpty(query))) {
            return tree.clearSearch();
        }

        if (_.isString(query)) {
            query = new RegExp(query, 'i');
        }

        var predicate;
        if (_.isRegExp(query)) {
            predicate = function(node) {
                return query.test(node.text);
            };
        }
        else {
            predicate = query;
        }

        tree.dom.batch();

        tree.model.recurseDown(function(node) {
            if (!node.removed()) {
                var match = predicate(node);
                var wasHidden = node.hidden();
                node.state('hidden', !match);

                // If hidden state will change
                if (wasHidden !== node.hidden()) {
                    node.markDirty();
                }

                if (match) {
                    matches.push(node);
                    node.expandParents();
                }
            }
        });

        tree.dom.end();

        return matches;
    }

    /**
     * Select children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    select() {
        return this.model.select.apply(this.model, arguments);
    }

    /**
     * Query for all selectable nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    selectable() {
        return this.model.selectable.apply(this.model, arguments);
    }

    /**
     * Select all nodes between a start and end node.
     * Starting node must have a higher index path so we can work down to endNode.
     *
     * @category Tree
     * @param {TreeNode} startNode Starting node
     * @param {TreeNode} endNode Ending node
     * @return {Tree} Tree instance.
     */
    selectBetween(startNode: TreeNode, endNode: TreeNode) {
        this.dom.batch();

        var node = startNode.nextVisibleNode();
        while (node) {
            if (node.id === endNode.id) {
                break;
            }

            node.select();

            node = node.nextVisibleNode();
        }

        this.dom.end();

        return this;
    };

    /**
     * Select all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    selectDeep() {
        return this.model.selectDeep.apply(this.model, arguments);
    }

    /**
     * Query for all selected nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    selected() {
        return this.model.selected.apply(this.model, arguments);
    }

    /**
     * Select the first available node at the root level.
     *
     * @category Tree
     * @return {TreeNode} Selected node object.
     */
    selectFirstAvailableNode() {
        var node = this.model.filter('available').get(0);
        if (node) {
            node.select();
        }

        return node;
    };

    /**
     * Show children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    show() {
        return this.model.show.apply(this.model, arguments);
    }

    /**
     * Show all children (deeply) in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    showDeep() {
        return this.model.showDeep.apply(this.model, arguments);
    }

    /**
     * Soft-remove children in this collection.
     *
     * @category Tree
     * @return {TreeNodes} Array of node objects.
     */
    softRemove() {
        return this.model.softRemove.apply(this.model, arguments);
    }

    /**
     * Sorts all TreeNode objects in this collection.
     *
     * If no custom sorter given, the configured "sort" value will be used.
     *
     * @category Tree
     * @param {string|function} sorter Sort function or property name.
     * @return {TreeNodes} Array of node obejcts.
     */
    sort() {
        return this.model.sort.apply(this.model, arguments);
    }

    /**
     * Resolve promise-like objects consistently.
     *
     * @private
     * @param {object} promise Promise-like object.
     * @returns {Promise} Promise
     */
    standardizePromise(promise) {
        return new Promise(function(resolve, reject) {
            if (!_.isObject(promise)) {
                return reject(new Error('Invalid Promise'));
            }

            if (_.isFunction(promise.then)) {
                promise.then(resolve);
            }

            // jQuery promises use "error"
            if (_.isFunction(promise.error)) {
                promise.error(reject);
            }
            else if (_.isFunction(promise.catch)) {
                promise.catch(reject);
            }
        });
    };

    /**
     * Returns a native Array of nodes.
     *
     * @category Tree
     * @return {array} Array of node objects.
     */
    toArray() {
        return this.model.toArray.apply(this.model, arguments);
    }

    /**
     * Resume events.
     *
     * @category Tree
     * @param {array} events Events to unmute.
     * @return {Tree} Tree instance.
     */
    unmute(events: Array<string>) {
        // Diff array and set to false if we're now empty
        if (_.isString(events) || _.isArray(events)) {
            this._muted = _.difference(this._muted, _.castArray(events));
            if (!this._muted.length) {
                this._muted = false;
            }
        }
        else {
            this._muted = false;
        }

        return this;
    };

    /**
     * Query for all visible nodes.
     *
     * @category Tree
     * @param {boolean} full Retain full hiearchy.
     * @return {TreeNodes} Array of node objects.
     */
    visible() {
        return this.model.visible.apply(this.model, arguments);
    }
}
