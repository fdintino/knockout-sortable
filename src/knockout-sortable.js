;(function(factory) {
    if (typeof define === "function" && define.amd) {
        // AMD anonymous module
        define(["knockout", "jquery", "jquery.ui/sortable"], factory);
    } else if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
        // CommonJS module
        var ko = require("knockout"),
            jQuery = require("jquery");
        require("jquery.ui/sortable");
        factory(ko, jQuery);
    } else {
        // No module loader (plain <script> tag) - put directly in global namespace
        factory(window.ko, window.jQuery);
    }
})(function(ko, $) {
    var ITEMKEY = "ko_sortItem",
        INDEXKEY = "ko_sourceIndex",
        LISTKEY = "ko_sortList",
        PARENTKEY = "ko_parentList",
        unwrap = ko.utils.unwrapObservable,
        dataGet = ko.utils.domData.get,
        dataSet = ko.utils.domData.set;

    //internal afterRender that adds meta-data to children
    var addMetaDataAfterRender = function(elements, data) {
        ko.utils.arrayForEach(elements, function(element) {
            if (element.nodeType === 1) {
                dataSet(element, ITEMKEY, data);
                dataSet(element, PARENTKEY, dataGet(element.parentNode, LISTKEY));
            }
        });
    };

    //prepare the proper options for the template binding
    var prepareTemplateOptions = function(valueAccessor, dataName) {
        var result = {},
            options = unwrap(valueAccessor()) || {},
            actualAfterRender;

        //build our options to pass to the template engine
        if (options.data) {
            result[dataName] = options.data;
            result.name = options.template;
        } else {
            result[dataName] = valueAccessor();
        }

        ko.utils.arrayForEach(["afterAdd", "afterRender", "as", "beforeRemove", "includeDestroyed", "templateEngine", "templateOptions", "nodes"], function (option) {
            if (options.hasOwnProperty(option)) {
                result[option] = options[option];
            } else if (ko.bindingHandlers.sortable.hasOwnProperty(option)) {
                result[option] = ko.bindingHandlers.sortable[option];
            }
        });

        //use an afterRender function to add meta-data
        if (dataName === "foreach") {
            if (result.afterRender) {
                //wrap the existing function, if it was passed
                actualAfterRender = result.afterRender;
                result.afterRender = function(element, data) {
                    addMetaDataAfterRender.call(data, element, data);
                    actualAfterRender.call(data, element, data);
                };
            } else {
                result.afterRender = addMetaDataAfterRender;
            }
        }

        //return options to pass to the template binding
        return result;
    };

    var updateIndexFromDestroyedItems = function(index, items) {
        var unwrapped = unwrap(items);

        if (unwrapped) {
            for (var i = 0; i < index; i++) {
                //add one for every destroyed item we find before the targetIndex in the target array
                if (unwrapped[i] && unwrap(unwrapped[i]._destroy)) {
                    index++;
                }
            }
        }

        return index;
    };

    //connect items with observableArrays
    ko.bindingHandlers.sortable = {
        init: function(element, valueAccessor, allBindingsAccessor, data, context) {
            var $element = $(element),
                value = unwrap(valueAccessor()) || {},
                templateOptions = prepareTemplateOptions(valueAccessor, "foreach"),
                sortable = {},
                onDragStartActual, onDropActual;

            //build a new object that has the global options with overrides from the binding
            $.extend(true, sortable, ko.bindingHandlers.sortable);
            if (value.options && sortable.options) {
                ko.utils.extend(sortable.options, value.options);
                delete value.options;
            }
            ko.utils.extend(sortable, value);

            //wrap the template binding
            ko.bindingHandlers.template.init(element, function() { return templateOptions; }, allBindingsAccessor, data, context);

            //keep a reference to onDragStart/onDrop functions that might have been passed in
            onDragStartActual = sortable.options.onDragStart;
            onDropActual = sortable.options.onDrop;

            //initialize sortable binding after template binding has rendered in onDrop function
            var createTimeout = setTimeout(function() {
                var dragItem;
                $element.sortable(ko.utils.extend(sortable.options, {
                    onDragStart: function onDragStart($item) {
                        //track original index
                        var el = $item[0];
                        dataSet(el, INDEXKEY, ko.utils.arrayIndexOf($item.parent().children(), el));

                        //make sure that fields have a chance to update model
                        $item.find("input:focus").change();
                        if (onDragStartActual) {
                            onDragStartActual.apply(this, arguments);
                        }
                    },
                    onDrop: function onDrop($item, container, _super, event) {
                        var sourceParent, targetParent, sourceIndex, targetIndex, arg,
                            el = $item[0],
                            parentEl = $item.parent()[0],
                            item = dataGet(el, ITEMKEY) || dragItem;

                        dragItem = null;

                        //make sure that moves only run once, as onDrop fires on multiple containers
                        if (item && (this === parentEl)) {
                            //identify parents
                            sourceParent = dataGet(el, PARENTKEY);
                            sourceIndex = dataGet(el, INDEXKEY);
                            targetParent = dataGet(el.parentNode, LISTKEY);
                            targetIndex = ko.utils.arrayIndexOf($item.parent().children(), el);

                            //take destroyed items into consideration
                            if (!templateOptions.includeDestroyed) {
                                sourceIndex = updateIndexFromDestroyedItems(sourceIndex, sourceParent);
                                targetIndex = updateIndexFromDestroyedItems(targetIndex, targetParent);
                            }

                            //build up args for the callbacks
                            if (sortable.beforeMove || sortable.afterMove) {
                                arg = {
                                    item: item,
                                    sourceParent: sourceParent,
                                    sourceParentNode: el.parentNode,
                                    sourceIndex: sourceIndex,
                                    targetParent: targetParent,
                                    targetIndex: targetIndex,
                                    cancelDrop: false
                                };

                                //execute the configured callback prior to actually moving items
                                if (sortable.beforeMove) {
                                    sortable.beforeMove.call(this, arg, event, $item, container);
                                }
                            }

                            _super.apply(this, arguments);

                            //if beforeMove told us to cancel, then we are done
                            if (arg && arg.cancelDrop) {
                                return;
                            }

                            //do the actual move
                            if (targetIndex >= 0) {
                                if (sourceParent) {
                                    sourceParent.splice(sourceIndex, 1);

                                    //if using deferred updates plugin, force updates
                                    if (ko.processAllDeferredBindingUpdates) {
                                        ko.processAllDeferredBindingUpdates();
                                    }
                                }

                                targetParent.splice(targetIndex, 0, item);
                            }

                            //rendering is handled by manipulating the observableArray; ignore dropped element
                            dataSet(el, ITEMKEY, null);

                            //if using deferred updates plugin, force updates
                            if (ko.processAllDeferredBindingUpdates) {
                                ko.processAllDeferredBindingUpdates();
                            }

                            //allow binding to accept a function to execute after moving the item
                            if (sortable.afterMove) {
                                sortable.afterMove.call(this, arg, event, $item, container);
                            }
                        }

                        if (onDropActual) {
                            onDropActual.apply(this, arguments);
                        }
                    }
                }));

                //handle enabling/disabling sorting
                if (sortable.isEnabled !== undefined) {
                    ko.computed({
                        read: function() {
                            $element.sortable(unwrap(sortable.isEnabled) ? "enable" : "disable");
                        },
                        disposeWhenNodeIsRemoved: element
                    });
                }
            }, 0);

            //handle disposal
            ko.utils.domNodeDisposal.addDisposeCallback(element, function() {
                //only call destroy if sortable has been created
                if ($element.data("ui-sortable") || $element.data("sortable")) {
                    $element.sortable("destroy");
                }

                //do not create the sortable if the element has been removed from DOM
                clearTimeout(createTimeout);
            });

            return { 'controlsDescendantBindings': true };
        },
        update: function(element, valueAccessor, allBindingsAccessor, data, context) {
            var templateOptions = prepareTemplateOptions(valueAccessor, "foreach");

            //attach meta-data
            dataSet(element, LISTKEY, templateOptions.foreach);

            //call template binding's update with correct options
            ko.bindingHandlers.template.update(element, function() { return templateOptions; }, allBindingsAccessor, data, context);
        },
        allowDrop: true,
        afterMove: null,
        beforeMove: null,
        options: {},
        templateEngine: ko.nativeTemplateEngine.instance
    };

    ko.expressionRewriting.bindingRewriteValidators['sortable'] = false; // Can't rewrite control flow bindings
    ko.virtualElements.allowedBindings['sortable'] = true;

});
