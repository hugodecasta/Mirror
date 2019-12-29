'use strict'

class Mirror {

    // ---------------------------------------------------- CONSTRUCT

    constructor(basename, boolMaster, upd_rate=100) {
        this.bm = boolMaster
        this.basename = basename
        this.upd_rate = upd_rate
        this.base = {}
        this.inhibiter = {}
        this.init_events()
        this.init_online_trigger_harvest()
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
                'act':function(path, prop, value) {
                    mom.set(path, prop, value)
                },
                'callbacks':{}
            },
            'new_prop': {
                'init':default_init,
                'act':function(path, prop, value) {
                    mom.set(path, prop, value)
                },
                'callbacks':{}
            },
            'del_prop': {
                'init':no_func,
                'act':function(path, prop) {
                    mom.del(path, prop)
                },
                'callbacks':{}
            }
        }
    }

    // ---------------------------------------------------- INNER

    get_base_point(path, def={}) {
        let base_point = this.base
        for(let prop of path) {
            if(!base_point.hasOwnProperty[prop]) {
                base_point[prop] = {}
                if(prop == path[path.length-1]) {
                    base_point[prop] = def
                }
            }
            base_point = base_point[prop]
        }
        return base_point
    }

    // ---------------------------------------------------- ACTION

    get(path,prop='',def={}) {
        if(prop != '') {
            path.push(prop)
        }
        return this.get_base_point(path, def)
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
        console.log(this.base)
    }

    del(path, prop) {
        let base_point = this.get_base_point(path)
        delete base_point[prop]
        this.trigger('del_prop',path,prop,null)
    }

    reset() {
        for(let prop in this.base) {
            this.del([],prop)
        }
    }

    // ---------------------------------------------------- ONLINEIFICATION

    // ------------------------------------ BM

    async online_write_base(base) {
        return await this.bm.write_key(this.basename, base)
    }

    async online_read_base() {
        if(!await this.bm.key_exists(this.basename)) {
            await this.online_write_base({base:{},events:{}})
        }
        return await this.bm.read_key(this.basename)
    }

    async online_set_base(base) {
        let full_base = await this.online_read_base()
        full_base.base = base
        await this.online_write_base(full_base)
    }

    async online_set_events(events) {
        let full_base = await this.online_read_base()
        full_base.events = events
        await this.online_write_base(full_base)
    }

    async online_get_base() {
        return (await this.online_read_base())['base']
    }

    async online_get_events() {
        return (await this.online_read_base())['events']
    }

    // ------------------------------------ ACT

    async harvest_online_triggers() {

        let all_triggers = await this.online_get_events()
        let new_triggers = {}
        let take = false
        for(let id in all_triggers) {
            if(id == this.last_trigger_id || this.last_trigger_id==null) {
                take = true
                continue
            }
            if(take || this.last_trigger_id==null) {
                new_triggers[id] = all_triggers[id]
            }
        }

        let all_ids = Object.keys(new_triggers)
        if(all_ids.length>0) {
            this.last_trigger_id = all_ids[all_ids.length-1]
        }
        this.handle_new_online_triggers(new_triggers)
    }

    handle_new_online_triggers(triggers) {
        for(let id in triggers) {
            if(this.inhibiter.hasOwnProperty(id)) {
                delete this.inhibiter[id]
                continue
            }
            let trigger = triggers[id]
            let event = trigger.event
            let path = trigger.path
            let prop = trigger.prop
            let value = trigger.value
            this.new_online_trigger(event, path, prop, value)
        }
    }

    async init_online_trigger_harvest() {
        let online_base = await this.online_get_base()
        for(let prop in online_base) {
            this.new_online_trigger('new_prop', [], prop, online_base[prop])
        }
        let events = await this.online_get_events()
        this.last_trigger_id = null
        let all_ids = Object.keys(events)
        if(all_ids.length>0) {
            this.last_trigger_id = all_ids[all_ids.length-1]
        }
        this.can_send_online = true
        let tthis = this
        setInterval(function() {
            tthis.harvest_online_triggers()
        },this.upd_rate)
    }

    async trigger_online(event, path, prop, value) {
        if(!this.can_send_online) {
            return
        }
        await this.online_set_base(this.base)
        let id = Math.random()+''+Date.now()
        this.inhibiter[id] = true
        let event_obj = {event, path, prop, value}
        let events = await this.online_get_events()
        events[id] = event_obj
        await this.online_set_events(events)
    }

    new_online_trigger(event, path, prop, value) {
        this.can_send_online = false
        this.waiters[event].act(path, prop, value)
        this.can_send_online = true
    }

    // ---------------------------------------------------- EVT HANDLE

    trigger(event, path, prop, value) {
        if(!this.waiters[event].callbacks.hasOwnProperty(path)) {
            return
        }
        for(let cb of this.waiters[event].callbacks[path]) {
            cb(prop,value)
        }
        this.trigger_online(event, path, prop, value)
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