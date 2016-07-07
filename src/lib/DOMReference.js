'use strict';
var DOMReference = (function () {
    function DOMReference() {
    }
    DOMReference.prototype.hook = function (node) {
        this.node = node;
    };
    return DOMReference;
}());
exports.DOMReference = DOMReference;
