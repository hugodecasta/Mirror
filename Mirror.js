'use strict'

class Mirror {

    // ---------------------------------------------------- CONSTRUCT

    constructor(boolMaster) {
        this.bm = boolMaster
        this.connectors = {}
        this.exists = {}
    }

    async connect(key) {
        if(this.connectors.hasOwnProperty(key)) {
            if(this.connectors[key].alive) {
                return this.connectors[key]
            }
        }
        let connector = new MirrorConnector(this.bm, key)
        await connector.init()
        this.connectors[key] = connector
        return connector
    }

    async can_connect(key) {
        return await this.bm.key_exists(key)
    }

    async create_base(key, data={}) {
        if(this.exists.hasOwnProperty(key)) {
            return
        }
        if(!await this.bm.key_exists(key) || (await this.bm.read_key(key)) == null) {
            this.exists[key] = true
            await this.bm.write_key(key,data)
            await this.connect(key)
        }
    }

}

class MirrorConnector {

    // --------------------------------------

    constructor(boolMaster, key) {

        this.bm = boolMaster
        this.key = key

        this.callback_inhibitor = {}
        this.waiters = []

        this.last_data = {}
        this.data = {}
    }

    // --------------------------------------

    async init() {
        this.alive = true
        let tthis = this
        this.int = setInterval(function() {
            tthis.update()
        },1000)
        await this.update()
    }

    kill_connector() {
        this.alive = false
        clearInterval(this.int)
        for(let cb of this.waiters) {
            cb('del_base',[],'',null)
        }
        this.waiters = []
    }

    delete() {
        this.data = null
        this.kill_connector()
        this.bm.key_remove(this.key)
    }

    // --------------------------------------

    diff_events(old_data, new_data, path=[]) {

        function event(event,path,prop,value) {
            return {event,path,prop,value}
        }

        let events = []

        if(old_data == null && typeof(new_data) == typeof({})) {
            old_data = {}
        }

        for(let prop in new_data) {
            let old_prop = null
            if(!old_data.hasOwnProperty(prop)) {
                events.push(event('add',path,prop,new_data[prop]))
            } else {
                old_prop = old_data[prop]
            }
            if(typeof(new_data[prop]) == typeof({})) {
                let sub_events = this.diff_events(old_prop,new_data[prop],path.concat(prop))
                events = events.concat(sub_events)
            } else {
                if(old_data[prop] != new_data[prop]) {
                    events.push(event('set',path,prop,new_data[prop]))
                }
            }
        }

        if(new_data == null && typeof(old_data) == typeof({})) {
            new_data = {}
        }

        for(let prop in old_data) {
            if(!new_data.hasOwnProperty(prop)) {
                events.push(event('del',path,prop,null))
            }
        }
        return events
    }

    async update() {
        if(JSON.stringify(this.last_data) == JSON.stringify(this.data)) {
            if(!await this.bm.key_exists(this.key)) {
                this.kill_connector()
                return
            }
            let loaded_data = await this.bm.read_key(this.key)
            if(loaded_data == null) {
                console.log(this.key,'file corrupted, replacing with existing base')
                await this.bm.write_key(this.key,this.data)
            } else {
                this.data = loaded_data
            }
        }
        let events = this.diff_events(this.last_data,this.data)
        for(let event of events) {
            this.trigger(event.event,event.path,event.prop,event.value)
        }
        this.last_data = JSON.parse(JSON.stringify(this.data))
        await this.bm.write_key(this.key,this.data)
    }

    trigger(event,path,prop,value) {
        for(let cb of this.waiters) {
            cb(event,path,prop,value)
        }
    }

    // --------------------------------------

    get_base_point(path,build_ways=true) {
        let base_point = this.data
        for(let sub_prop of path) {
            if(!base_point.hasOwnProperty(sub_prop)) {
                if(!build_ways) {
                    return null
                }
                base_point[sub_prop] = {}
            }
            base_point = base_point[sub_prop]
        }
        return base_point
    }

    get_base() {
        return this.data
    }

    get_direct(prop, def=null) {
        return this.get([],prop,def)
    }

    get(path, prop, def=null) {
        let base_point = this.get_base_point(path, false)
        if(base_point == null || !base_point.hasOwnProperty(prop)) {
            return def
        }
        return base_point[prop]
    }

    set_direct(prop, value) {
        this.set([],prop,value)
    }

    set(path, prop, value) {
        let base_point = this.get_base_point(path)
        base_point[prop] = value
        this.update()
    }

    set_base(value) {
        this.data = value
        this.update()
    }

    del_direct(prop) {
        this.del([],prop)
    }

    del(path, prop) {
        let base_point = this.get_base_point(path)
        delete base_point[prop]
        this.update()
    }

    // --------------------------------------

    reset_waiters() {
        this.waiters = []
    }

    on(callback) {
        
        this.waiters.push(callback)
        
        function trig_obj(obj,path=[]) {
            for(let prop in obj) {
                callback('add',path,prop,obj[prop])
                callback('set',path,prop,obj[prop])
                if(typeof(obj[prop]) == typeof({})) {
                    trig_obj(obj[prop],path.concat(prop))
                }
            }
        }

        trig_obj(this.data)

        if(!this.alive) {
            this.kill_connector()
        }
    }

    on_event(event, callback) {
        function my_cb(ret_event, ret_path, ret_prop, ret_value) {
            if(event == ret_event) {
                callback(ret_path, ret_prop, ret_value)
            }
        }
        this.on(my_cb)
    }

    on_path(event, path, callback) {
        function my_cb( ret_path, ret_prop, ret_value) {
            if(JSON.stringify(path) == JSON.stringify(ret_path)) {
                callback(ret_prop, ret_value)
            }
        }
        this.on_event(event, my_cb)
    }

    on_prop(event, path, prop, callback) {
        function my_cb(ret_prop, ret_value) {
            if(prop == ret_prop) {
                callback(ret_value)
            }
        }
        this.on_path(event, path, my_cb)
    }


}