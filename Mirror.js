'use strict'

class Mirror {

    // ---------------------------------------------------- CONSTRUCT

    constructor() {
        this.base = {}
        this.init_events()
    }

    // ---------------------------------------------------- EVENTS

    init_events() {
        let mom = this

        function default_init(path, callback) {
            let base_point = mom.get_base_point(path)
            for(let prop in base_point) {
                callback(prop, base_point[prop])
            }
        }

        function no_func(){}

        this.waiters = {
            'set_prop':{
                'init':default_init,
                'callbacks':{}
            },
            'new_prop': {
                'init':default_init,
                'callbacks':{}
            },
            'del_prop': {
                'init':no_func,
                'callbacks':{}
            }
        }
    }

    // ---------------------------------------------------- INNER

    get_base_point(path) {
        let base_point = this.base
        for(let prop of path) {
            base_point = base_point[prop]
        }
        return base_point
    }

    // ---------------------------------------------------- ACTION

    get(path,prop='') {
        if(prop != '') {
            path.push(prop)
        }
        return this.get_base_point(path)
    }

    set(path, prop, value) {

        let base_point = this.get_base_point(path)
        let was_new = !base_point.hasOwnProperty(prop)
        let was_same = JSON.stringify(base_point[prop]) == JSON.stringify(value)

        if(typeof(value) == typeof({})) {
            if(was_new) {
                base_point[prop] = {}
            }
            for(let sub_prop in value) {
                let sub_path = JSON.parse(JSON.stringify(path))
                sub_path.push(prop)
                this.set(sub_path, sub_prop, value[sub_prop])
            }
        }

        if(!was_same) {
            base_point[prop] = value
            let event = 'set_prop'
            if(was_new) {
                event = 'new_prop'
            }
            this.trigger(event, path, prop, value)
        }
    }

    del(path, prop) {
        let base_point = this.get_base_point(path)
        let old_value = base_point[prop]
        delete base_point[prop]
        this.trigger('del_prop',path,prop)
    }

    // ---------------------------------------------------- EVT HANDLE

    trigger(event, path, prop, value) {
        if(!this.waiters[event].callbacks.hasOwnProperty(path)) {
            return
        }
        for(let cb of this.waiters[event].callbacks[path]) {
            cb(prop,value)
        }
    }

    on(event, path, callback) {

        this.waiters[event].init(path, callback)

        if(!this.waiters[event].callbacks.hasOwnProperty(path)) {
            this.waiters[event].callbacks[path] = []
        }
        this.waiters[event].callbacks[path].push(callback)
    }

    on_prop(event, path, prop, callback) {
        let inner_cb = function(gprop, value) {
            if(gprop == prop) {
                callback(value)
            }
        }
        this.on(event,path,inner_cb)
    }

}