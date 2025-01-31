"use strict";

/*
 * Created with @iobroker/create-adapter v1.29.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
const xml2js = require("xml2js");

// Load your modules here, e.g.:
// const fs = require("fs");

let timeOutMessage;
let sessionTimestamp = 0;
let notifyTimestamp = 0;
let lastSleepClear = 0;
let sleeps = new Map();
let polling = false;

class FrontierSilicon extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "frontier_silicon",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		//this.log.info("config PIN: " + this.config.PIN);
		//this.log.info("config IP: " + this.config.IP);

		await this.getDeviceInfo();
		//await this.createSession();
		await this.discoverState();
		await this.discoverDeviceFeatures();
		await this.getAllPresets(false);

		this.onFSAPIMessage();
		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		//this.subscribeStates("testVariable");
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates("lights.*");
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		this.subscribeStates("device.power");
		this.subscribeStates("device.friendlyName");
		this.subscribeStates("modes.*.switchTo");
		this.subscribeStates("modes.*.presets.*.recall");
		this.subscribeStates("modes.selected");
		this.subscribeStates("modes.selectPreset");
		this.subscribeStates("audio.mute");
		this.subscribeStates("audio.volume");
		this.subscribeStates("modes.readPresets");
		this.subscribeStates("media.control.*");
		this.subscribeStates("audio.control.*");
		this.subscribeStates("media.state");
		if(this.log.level=="debug" || this.log.level=="silly")
		{
			this.subscribeStates("debug.resetSession");
		}

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		//await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		//await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		//await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		//let result = await this.checkPasswordAsync("admin", "iobroker");
		//this.log.info("check user admin pw iobroker: " + result);

		//result = await this.checkGroupAsync("admin", "admin");
		//this.log.info("check group user admin group admin: " + result);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			clearTimeout(timeOutMessage);
			sleeps.forEach((value, key , sleeps) => 
				{
					clearTimeout(value);
				});
			sleeps.clear();

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (notifyTimestamp <= Date.now() - (this.config.PollIntervall * 1000 + 40000))
		{
			clearTimeout(timeOutMessage);
			timeOutMessage = setTimeout(() => this.onFSAPIMessage(), 1); // Poll states every configured seconds
		}
		if (state) {
			if (!id || !state || state.ack) return;
			// The state was changed
			this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
			//const setState = this.setStateAsync;
			const zustand = id.split(".");
			const adapter = this;

			//let result;
			switch(zustand[2])
			{
				case "device":
					switch(zustand[3])
					{
						case "power":
							this.log.debug("Ein-/Ausschalten");
							//const adapter = this;
							await adapter.callAPI("netRemote.sys.power", state.val ? "1" : "0")
								.then(async function (result) {
									if(result.success) {
										await adapter.setStateAsync("device.power", {val:state.val, ack: true});
									}
								});

							if(state.val && this.config.SangeanNoSound)
							{
								adapter.makeSangeanDABPlay();
							}
							break;
						case "friendlyName":
							this.log.debug("Umbenennen");

							if(state != null && state != undefined && state.val != null && state.val != undefined)
							{
								const name = state.val.toString();
								await adapter.callAPI("netRemote.sys.info.friendlyName", name)
									.then(async (result) => {
										if(result.success) {
											await adapter.setStateAsync("device.friendlyName", {val:name.toString(), ack: true});
										}
									});
							}
							break;
						default:
							break;
					}
					break;
				case "modes":
					if((zustand.length == 5 && zustand[4] === "switchTo")
						|| (zustand.length == 7 && zustand[4] === "presets" && zustand[6] === "recall"))
					{
						// frontier_silicon.0.modes.2.switchTo
						this.log.debug("Modus umschalten");
						await adapter.callAPI("netRemote.sys.mode", zustand[3])
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("modes.selected", {val:Number(zustand[3]), ack: true});
									await adapter.getStateAsync(`modes.${zustand[3]}.label`)
										.then(async function (lab) {
											if(lab !== null && lab !== undefined && lab.val !== null)
											{
												await adapter.setStateAsync("modes.selectedLabel", {val:lab.val, ack: true});
											}
										});
									//adapter.setStateAsync("modes.selectPreset", {val:null, ack: true});
								}
							});
					}
					// frontier_silicon.1.modes.4.presets.2.recall
					if(zustand.length == 7 && zustand[4] === "presets" && zustand[6] === "recall")
					{
						await this.callAPI("netRemote.nav.state", "1");
						await adapter.callAPI("netRemote.nav.action.selectPreset", zustand[5])
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("modes.selectPreset", {val:zustand[5], ack: true});
								}
							});
						//adapter.getSelectedPreset();
					}
					// frontier_silicon.1.modes.selected
					else if(zustand[3] === "selected" && state.val !== null)
					{
						this.log.debug("Modus umschalten");
						await adapter.callAPI("netRemote.sys.mode", state.val.toString())
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("modes.selected", {val:Number(state.val), ack: true});
									await adapter.getStateAsync(`modes.${state.val}.label`)
										.then(async function (lab) {
											if(lab !== null && lab !== undefined && lab.val !== null)
											{
												await adapter.setStateAsync("modes.selectedLabel", {val:lab.val, ack: true});
											}
										});
										await adapter.callAPI("netRemote.play.info.graphicUri")
										.then(async function (result) {
											await adapter.setStateAsync("media.graphic", { val: result.result.value[0].c8_array[0].trim(), ack: true });
										});
									//adapter.setStateAsync("modes.selectPreset", {val:null, ack: true});
								}
							});
					}
					else if(zustand[3] === "selectPreset" && state.val !== null)
					{
						this.log.debug(`Selecting Preset ${state.val}`);
						await this.callAPI("netRemote.nav.state", "1");
						await adapter.callAPI("netRemote.nav.action.selectPreset", state.val.toString())
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("modes.selectPreset", {val:state.val, ack: true});
									await adapter.callAPI("netRemote.play.info.graphicUri")
										.then(async function (result) {
											await adapter.setStateAsync("media.graphic", { val: result.result.value[0].c8_array[0].trim(), ack: true });
										});
								}
							});
					}
					else if(zustand[3] === "readPresets")
					{
						await this.getAllPresets(true);
					}
					break;
				case "audio":
					if(zustand[3] === "volume" && state.val !== null)
					{
						await this.callAPI("netRemote.nav.state", "1");
						if(state.val >= 0 && state.val <= this.config.VolumeMax)
						{
							await adapter.callAPI("netRemote.sys.audio.volume", state.val.toString())
								.then(async function (result) {
									if(result.success) {
										await adapter.setStateAsync("audio.volume", {val:Number(state.val), ack: true});
									}
								});
						}
					}
					else if(zustand[3] === "mute" && state.val !== null)
					{
						await this.callAPI("netRemote.nav.state", "1");
						await adapter.callAPI("netRemote.sys.audio.mute", state.val ? "1" : "0")
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("audio.mute", {val:state.val, ack: true});
								}
							});
					}
					else
					{
						switch(zustand[4])
						{
							case "volumeUp":
								await this.callAPI("netRemote.nav.state", "1");
								await adapter.getStateAsync("audio.volume")
									.then(async function (result) {
										if(result != null && result != undefined && result.val != null && result.val != undefined
											&& result.val < adapter.config.VolumeMax)
										{
											// @ts-ignore
											const vol = parseInt(result.val) + 1;
											await adapter.callAPI("netRemote.sys.audio.volume", vol.toString())
												.then(async function (result) {
													if(result.success) {
														await adapter.setStateAsync("audio.volume", {val:Number(vol), ack: true});
													}
												});
										}
									});
								break;
							case "volumeDown":
								await this.callAPI("netRemote.nav.state", "1");
								await adapter.getStateAsync("audio.volume")
									.then(async function (result) {
										if(result != null && result != undefined && result.val != null && result.val != undefined
											&& result.val > 0)
										{
											// @ts-ignore
											const vol = parseInt(result.val) - 1;
											await adapter.callAPI("netRemote.sys.audio.volume", vol.toString())
												.then(async function (result) {
													if(result.success) {
														await adapter.setStateAsync("audio.volume", {val:Number(vol), ack: true});
													}
												});
										}
									});
								break;
							default:
								break;
						}
					}
					break;
				case "media":
					if(zustand[3] === "state")
					{
						let z = -1;
						if(state.val === 0)
						{
							z = 2;
						}
						else if(state.val === 1)
						{
							z = 1;
						}
						else
						{
							return;
						}
						await this.callAPI("netRemote.nav.state", "1");
						await this.callAPI("netRemote.play.control", z.toString())
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("media.state", {val:state.val, ack: true});
								}
							});
					}
					else if(zustand[3] === "control" && zustand[4] === "play")
					{
						await this.callAPI("netRemote.nav.state", "1");
						await this.callAPI("netRemote.play.control", "1")
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("media.state", {val:1, ack: true});
								}
							});
					}
					else if(zustand[3] === "control" && zustand[4] === "pause")
					{
						await this.callAPI("netRemote.nav.state", "1");
						await this.callAPI("netRemote.play.control", "2")
							.then(async function (result) {
								if(result.success) {
									await adapter.setStateAsync("media.state", {val:0, ack: true});
								}
							});
					}
					else if(zustand[3] === "control" && zustand[4] === "next")
					{
						await this.callAPI("netRemote.nav.state", "1");
						await this.callAPI("netRemote.play.control", "3");
					}
					else if(zustand[3] === "control" && zustand[4] === "previous")
					{
						await this.callAPI("netRemote.nav.state", "1");
						await this.callAPI("netRemote.play.control", "4");
					}
					break;
				case "debug":
					if(zustand[3] === "resetSession")
					{
						await this.createSession();
					}
					break;
				default:
					break;
			}
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	makeSangeanDABPlay()
	{
		this.sleep(100);
		const adapter = this;
		this.callAPI("netRemote.sys.mode")
			.then(function (result) {
				adapter.getStateAsync(`modes.${result.result.value[0].u32[0]}.id`)
					.then(function (res){
						if(res !== null && res !== undefined && res.val !== null && res.val === "DAB")
						{
							adapter.sleep(2000).then(function (){
								adapter.getStateAsync("modes.mediaplayer")
									.then(function (r) {
										if(r !== null && r !== undefined && r.val !== null)
										{
											adapter.callAPI("netRemote.sys.mode", r.val.toString());
											adapter.sleep(2000).then(function (){
												adapter.callAPI("netRemote.sys.mode", result.result.value[0].u32[0]);
											});
										}
									});
							});
						}
					});
			});

	}

	async discoverDeviceFeatures()
	{
		const result = await this.callAPI("netRemote.sys.caps.validModes", "", -1, 100);

		if(!result.success) return;

		let key = result.result.item[0].$.key;
		let selectable = false;
		let label = "";
		let streamable = false;
		let id = "";

		await result.result.item.forEach(item => {
			key = item.$.key;
			id = "";
			selectable = false;
			label = "";
			streamable = false;
			item.field.forEach(f => {
				switch (f.$.name) {
					case "id":
						id = f.c8_array[0];
						break;
					case "selectable":
						selectable = f.u8[0] == 1;
						break;
					case "label":
						label = f.c8_array[0];
						break;
					case "streamable":
						streamable = f.u8[0] == 1;
						break;
					default:
						break;
				}
			});

			this.log.debug(`ModeMaxIndex: ${this.config.ModeMaxIndex} - Key: ${key}`);
			if(this.config.ModeMaxIndex === undefined || this.config.ModeMaxIndex < key) this.config.ModeMaxIndex = key;

			if(id === "MP" && this.config.SangeanNoSound)
			{
				this.setObjectNotExistsAsync(`modes.mediaplayer`, {
					type: "state",
					common: {
						name: "Media Player Mode Key",
						type: "number",
						role: "media.input",
						read: true,
						write: false,
					},
					native: {},
				});
				this.setStateAsync("modes.mediaplayer", { val: key, ack: true });
			}

			this.setObjectNotExistsAsync(`modes.${key}`, {
				type: "channel",
				common: {
					name: label
				},
				native: {},
			});

			this.setObjectNotExistsAsync(`modes.${key}.key`, {
				type: "state",
				common: {
					name: "Mode Key",
					type: "number",
					role: "media.input",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${key}.key`, { val: Number(key), ack: true });
			this.setObjectNotExistsAsync(`modes.${key}.id`, {
				type: "state",
				common: {
					name: "Mode ID",
					type: "string",
					role: "text",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${key}.id`, { val: id, ack: true });
			this.setObjectNotExistsAsync(`modes.${key}.label`, {
				type: "state",
				common: {
					name: "Mode Label",
					type: "string",
					role: "text",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${key}.label`, { val: label, ack: true });
			this.setObjectNotExistsAsync(`modes.${key}.streamable`, {
				type: "state",
				common: {
					name: "Mode streamable",
					type: "boolean",
					role: "indicator",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${key}.streamable`, { val: streamable, ack: true });
			this.setObjectNotExistsAsync(`modes.${key}.selectable`, {
				type: "state",
				common: {
					name: "Mode selectable",
					type: "boolean",
					role: "indicator",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${key}.selectable`, { val: selectable, ack: true });
			if(selectable)
			{
				this.setObjectNotExistsAsync(`modes.${key}.switchTo`, {
					type: "state",
					common: {
						name: "Switch to mode",
						type: "boolean",
						role: "button",
						read: false,
						write: true,
					},
					native: {},
				});
				this.setObjectNotExistsAsync(`modes.readPresets`, {
					type: "state",
					common: {
						name: "Read presets",
						type: "boolean",
						role: "button",
						read: false,
						write: true,
					},
					native: {},
				});
			}
			this.log.debug(`ID: ${id} - Selectable: ${selectable} - Label: ${label} - Key: ${key}`);
		});
	}

	/**
	 * Reads presets for all modes
	 * @param {boolean} force Force rescan of all presets
	 */
	async getAllPresets(force)
	{
		this.log.debug("Getting presets");
		let result = await this.callAPI("netRemote.nav.state", "1");
		if(!result.success) return;
		result = await this.callAPI("netRemote.sys.mode");
		const mode = result.result.value[0].u32[0];
		let unmute = false;

		const mute = await this.callAPI("netRemote.sys.audio.mute");
		unmute = mute.result.value[0].u8[0] == 0;
		this.log.debug(`Mute: ${JSON.stringify(mute)} - Unmute: ${unmute.toString()}`);

		for(let i=0;i<=this.config.ModeMaxIndex;++i)
		{
			this.log.debug("Getting Modes");
			let mode = await this.getStateAsync(`modes.${i}.key`);
			if(mode === null) continue;
			this.log.debug(`Mode ${i}`);

			if(!force)
			{
				mode = await this.getStateAsync(`modes.${i}.presets.available`);
				this.log.debug(JSON.stringify(mode));
				if(mode !== null) continue;
			}
			await this.getModePresets(i, unmute);
		}
		await this.callAPI("netRemote.sys.mode", mode);
		if(unmute)
		{
			await this.callAPI("netRemote.sys.audio.mute", "0");
		}
	}

	async getModePresets(mode, unmute = false)
	{
		this.log.debug(`Presets ${mode}`);

		let result = await this.callAPI("netRemote.sys.mode", mode.toString());
		await this.sleep(1000);
		result = await this.callAPI("netRemote.nav.state", "1");
		result = await this.callAPI("netRemote.nav.presets", "", -1, 65535);

		let key = 0;
		let name = "";
		//presets.clear();

		await this.setObjectNotExistsAsync(`modes.${mode}.presets`, {
			type: "channel",
			common: {
				name: "Presets"
			},
			native: {},
		});

		//const available = await this.getStateAsync(`modes.${mode}.presets.available`);
		await this.setObjectNotExistsAsync(`modes.${mode}.presets.available`, {
			type: "state",
			common: {
				name: "Mode Key",
				type: "boolean",
				role: "indicator",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setStateAsync(`modes.${mode}.presets.available`, { val: result.success, ack: true });
		//this.log.debug(result.success.toString() + " - " + (available !== undefined).toString());
		if(!result.success) return;

		if(unmute)
		{
			await this.callAPI("netRemote.sys.audio.mute", "1");
		}
		await result.result.item.forEach(item => {
			//this.setStateAsync(`modes.${mode}.presets.available`, { val: true, ack: true });
			key = item.$.key;
			item.field.forEach(f => {
				//this.log.debug(key.toString());
				//this.log.debug(JSON.stringify(item));
				//this.log.debug(JSON.stringify(f));
				switch (f.$.name) {
					case "name":
						name = f.c8_array[0];
						break;
					default:
						break;
				}
			});

			this.log.debug(name);
			this.setObjectNotExistsAsync(`modes.${mode}.presets.${key}`, {
				type: "channel",
				common: {
					name: `Preset ${key}`
				},
				native: {},
			});
			this.setObjectNotExistsAsync(`modes.${mode}.presets.${key}.name`, {
				type: "state",
				common: {
					name: "Preset Name",
					type: "string",
					role: "text",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${mode}.presets.${key}.name`, { val: name.toString().trim(), ack: true });
			this.setObjectNotExistsAsync(`modes.${mode}.presets.${key}.key`, {
				type: "state",
				common: {
					name: "Preset Key",
					type: "number",
					role: "media.playid",
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`modes.${mode}.presets.${key}.key`, { val: Number(key), ack: true });
			this.setObjectNotExistsAsync(`modes.${mode}.presets.${key}.recall`, {
				type: "state",
				common: {
					name: "Recall Preset",
					type: "boolean",
					role: "button",
					read: false,
					write: true,
				},
				native: {},
			});
			//presets.set(name.toString().trim(), key);
		});
	}

	/**
	 * Get state of the device
	 */
	async discoverState()
	{
		//const log = this.log;
		await this.setObjectNotExistsAsync("device.power", {
			type: "state",
			common: {
				name: "Power",
				type: "boolean",
				role: "switch.power",
				read: true,
				write: true,
			},
			native: {},
		});

		let power = await this.callAPI("netRemote.sys.power");
		this.log.debug(JSON.stringify(power));
		if(power.success)
		{
			this.log.debug(`Power: ${power.result.value[0].u8[0] == 1}`);
			await this.setStateAsync("device.power", { val: power.result.value[0].u8[0] == 1, ack: true });
		}

		await this.setObjectNotExistsAsync("modes.selected", {
			type: "state",
			common: {
				name: "Mode",
				type: "number",
				role: "media.input",
				read: true,
				write: true,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.sys.mode");
		if(power.success)
		{
			this.log.debug(`Mode: ${power.result.value[0].u32[0]}`);
			await this.setStateAsync("modes.selected", { val: Number(power.result.value[0].u32[0]), ack: true });
		}

		await this.setObjectNotExistsAsync("media.name", {
			type: "state",
			common: {
				name: "Media name",
				type: "string",
				role: "text",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.name");
		if(power.success)
		{
			this.setStateAsync("media.name", { val: power.result.value[0].c8_array[0].trim(), ack: true });
			await this.UpdatePreset(power.result.value[0].c8_array[0].trim());
		}

		await this.setObjectNotExistsAsync("media.album", {
			type: "state",
			common: {
				name: "Media name",
				type: "string",
				role: "media.album",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.album");
		if(power.success)
		{
			await this.setStateAsync("media.album", { val: power.result.value[0].c8_array[0].trim(), ack: true });
		}

		await this.setObjectNotExistsAsync("media.title", {
			type: "state",
			common: {
				name: "Media title",
				type: "string",
				role: "media.title",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.title");
		if(power.success)
		{
			await this.setStateAsync("media.title", { val: power.result.value[0].c8_array[0].trim(), ack: true });
		}

		await this.setObjectNotExistsAsync("media.artist", {
			type: "state",
			common: {
				name: "Media artist",
				type: "string",
				role: "media.artist",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.artist");
		if(power.success)
		{
			await this.setStateAsync("media.artist", { val: power.result.value[0].c8_array[0].trim(), ack: true });
		}

		await this.setObjectNotExistsAsync("media.text", {
			type: "state",
			common: {
				name: "Media text",
				type: "string",
				role: "text",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.text");
		if(power.success)
		{
			await this.setStateAsync("media.text", { val: power.result.value[0].c8_array[0].trim(), ack: true });
		}

		await this.setObjectNotExistsAsync("media.graphic", {
			type: "state",
			common: {
				name: "Media text",
				type: "string",
				role: "media.cover",
				read: true,
				write: false,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.info.graphicUri");
		if(power.success)
		{
			await this.setStateAsync("media.graphic", { val: power.result.value[0].c8_array[0].trim(), ack: true });
		}

		await this.setObjectNotExistsAsync("modes.selectPreset", {
			type: "state",
			common: {
				name: "Mode",
				type: "number",
				role: "media.track",
				read: false,
				write: true,
			},
			native: {},
		});
		//this.getSelectedPreset();

		await this.setObjectNotExistsAsync("modes.selectedLabel", {
			type: "state",
			common: {
				name: "Mode",
				type: "string",
				role: "media.input",
				read: true,
				write: false,
			},
			native: {},
		});
		try
		{
			power.value = await this.getStateAsync(`modes.${power.result.value[0].u32[0]}.label`);
			if(power.success && power.value !== null)
			{
				this.log.debug(`Mode: ${power.value.val}`);
				await this.setStateAsync("modes.selectedLabel", { val: power.value.val, ack: true });
			}
		}
		catch (ex)
		{
			this.log.debug(ex.message);
		}

		//netRemote.sys.audio.volume
		power = await this.callAPI("netRemote.sys.audio.volume");
		await this.setObjectNotExistsAsync("audio.volume", {
			type: "state",
			common: {
				name: "Volume",
				type: "number",
				role: "level.volume",
				read: true,
				write: true,
			},
			native: {},
		});
		if(power.success && power.value !== null)
		{
			await this.setStateAsync("audio.volume", { val: Number(power.result.value[0].u8[0]), ack: true });
		}

		//netRemote.sys.audio.mute
		power = await this.callAPI("netRemote.sys.audio.mute");
		await this.setObjectNotExistsAsync("audio.mute", {
			type: "state",
			common: {
				name: "Mute",
				type: "boolean",
				role: "media.mute",
				read: true,
				write: true,
			},
			native: {},
		});
		if(power.success && power.value !== null)
		{
			await this.setStateAsync("audio.mute", { val: power.result.value[0].u8[0] == 1, ack: true });
		}

		await this.setObjectNotExistsAsync("audio.control", {
			type: "channel",
			common: {
				name: "Media control",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("audio.control.volumeUp", {
			type: "state",
			common: {
				name: "Volume Up",
				type: "boolean",
				role: "button.volume.up",
				read: false,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("audio.control.volumeDown", {
			type: "state",
			common: {
				name: "Volume Down",
				type: "boolean",
				role: "button.volume.down",
				read: false,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("media.control", {
			type: "channel",
			common: {
				name: "Media control",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("media.control.play", {
			type: "state",
			common: {
				name: "Play",
				type: "boolean",
				role: "button.play",
				read: false,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("media.control.pause", {
			type: "state",
			common: {
				name: "Pause",
				type: "boolean",
				role: "button.pause",
				read: false,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("media.control.previous", {
			type: "state",
			common: {
				name: "Previous",
				type: "boolean",
				role: "button.prev",
				read: false,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("media.control.next", {
			type: "state",
			common: {
				name: "Next",
				type: "boolean",
				role: "button.forward",
				read: false,
				write: true,
			},
			native: {},
		});
		power = await this.callAPI("netRemote.play.control");
		await this.setObjectNotExistsAsync("media.state", {
			type: "state",
			common: {
				name: "State",
				type: "number",
				role: "media.state",
				read: true,
				write: true,
			},
			native: {},
		});
		if(power.success && power.value !== null)
		{
			switch (power.result.value[0].u8[0])
			{
				// Play
				case "1":
					await this.setStateAsync("media.state", { val: 1, ack: true });
					break;
				// Pause
				case "2":
					await this.setStateAsync("media.state", { val: 0, ack: true });
					break;
				default:
					break;
			}
		}

		if(this.log.level=="debug" || this.log.level=="silly")
		{
			await this.setObjectNotExistsAsync("debug", {
				type: "channel",
				common: {
					name: "Debugging Tools",
				},
				native: {},
			});
			await this.setObjectNotExistsAsync("debug.resetSession", {
				type: "state",
				common: {
					name: "Reset Session",
					type: "boolean",
					role: "button",
					read: false,
					write: true,
				},
				native: {},
			});
			await this.setObjectNotExistsAsync("debug.session", {
				type: "state",
				common: {
					name: "Session ID",
					type: "number",
					role: "value",
					read: true,
					write: false,
				},
				native: {},
			});
			await this.setObjectNotExistsAsync("debug.sessionCreationTime", {
				type: "state",
				common: {
					name: "Session Timestamp",
					type: "number",
					role: "value.time",
					read: true,
					write: false,
				},
				native: {},
			});
			await this.setObjectNotExistsAsync("debug.lastNotifyCall", {
				type: "state",
				common: {
					name: "Timestamp of last notify call",
					type: "number",
					role: "value.time",
					read: true,
					write: false,
				},
				native: {},
			});
			await this.setObjectNotExistsAsync("debug.lastNotifyError", {
				type: "state",
				common: {
					name: "Error of last notify call",
					type: "string",
					role: "text",
					read: true,
					write: false,
				},
				native: {},
			});
		}
		else
		{
			await this.deleteChannel("debug");
		}
	}

	/**
	Get basic device info and FSAPI URL
	*/
	async getDeviceInfo()
	{
		const log = this.log;
		await this.setObjectNotExistsAsync("device.friendlyName", {
			type: "state",
			common: {
				name: "Friendly Name",
				type: "string",
				role: "info.name",
				read: true,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("device.webfsapi", {
			type: "state",
			common: {
				name: "Web FSAPI URL",
				type: "string",
				role: "info.address",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("device.version", {
			type: "state",
			common: {
				name: "SW Version",
				type: "string",
				role: "text",
				read: true,
				write: false,
			},
			native: {},
		});

		const dev = {};

		await axios.get(`http://${this.config.IP}/devices`)
			.then(async device => {
				//log.debug(device.)
				const parser = new xml2js.Parser();
				parser.parseStringPromise(device.data).then(function (result) {
					log.debug(result.netRemote.friendlyName);
					dev.friendlyName = result.netRemote.friendlyName;
					dev.version = result.netRemote.version;
					dev.webfsapi = result.netRemote.webfsapi;
					log.debug("Hallo PARSER");

				})
					.catch(function (err) {
					// Failed});
						log.debug(JSON.stringify(err));
						log.debug("Hallo FEHLER");
					});
			});

		if(dev.friendlyName !== null)
		{
			await this.setStateAsync("device.friendlyName", { val: dev.friendlyName.toString(), ack: true });
		}
		if(dev.version !== null)
		{
			await this.setStateAsync("device.version", { val: dev.version.toString(), ack: true });
		}
		if(dev.webfsapi !== null)
		{
			await this.setStateAsync("device.webfsapi", { val: dev.webfsapi.toString(), ack: true });
			this.config.fsAPIURL = dev.webfsapi;
		}

		await this.setObjectNotExistsAsync("device.radioId", {
			type: "state",
			common: {
				name: "Radio ID",
				type: "string",
				role: "text",
				read: true,
				write: false,
			},
			native: {},
		});
		let result = await this.callAPI("netRemote.sys.info.radioId");
		if(result.success)
		{
			await this.setStateAsync("device.radioId", {val: result.result.value[0].c8_array[0], ack: true});
		}

		//netRemote.sys.caps.volumeSteps
		await this.setObjectNotExistsAsync("audio.maxVolume", {
			type: "state",
			common: {
				name: "Max Volume setting",
				type: "number",
				role: "value.max",
				read: true,
				write: false,
			},
			native: {},
		});
		result = await this.callAPI("netRemote.sys.caps.volumeSteps");
		if(result.success)
		{
			await this.setStateAsync("audio.maxVolume", {val: result.result.value[0].u8[0]-1, ack: true});
			this.config.VolumeMax = result.result.value[0].u8[0] - 1;
		}
	}

	/**
	 * Call FSAPI
	 * @param {string} command
	 * @param {string} value optional
	 * @param {number} start optional, nur bei Listen, default ist -1
	 * @param {number} maxItems optional, nur bei Listen, default ist 65535
	 * @param {boolean} notify optional, true, wenn auf Nachrichten gewartet werden soll
	 */
	async callAPI(command, value = "", start = -65535, maxItems = 65535, notify = false)
	{
		//const log = this.log;
		let conn = await this.getStateAsync("info.connection");
		const answer = {};
		answer.success = false;

		if(conn !== null && conn !== undefined)
		{
			if(!conn.val || this.config.SessionID === 0
				|| sessionTimestamp <= Date.now() - this.config.RecreateSessionInterval * 60 * 1000)
			{
				await this.createSession();
			}
		}
		else
		{
			await this.createSession();
		}
		conn = await this.getStateAsync("info.connection");
		this.log.debug(JSON.stringify(conn));
		if(conn !== null && conn !== undefined && conn.val)
		{
			let url = "";
			const log = this.log;
			const adapter = this;

			if(command.toUpperCase().startsWith("/FSAPI"))
			{
				command = command.substring(6);
			}
			if(command.toUpperCase().startsWith("/GET") || command.toUpperCase().startsWith("/SET"))
			{
				command = command.substring(5);
			}
			if(command.toUpperCase().startsWith("/LIST_GET_NEXT"))
			{
				command = command.substring(14);
			}

			if(notify)
			{
				url = `${this.config.fsAPIURL}/GET_NOTIFIES?pin=${this.config.PIN}&sid=${this.config.SessionID}`;
			}
			else if(start > - 65535)
			{
				url = `${this.config.fsAPIURL}/LIST_GET_NEXT/${command}/${start}?pin=${this.config.PIN}&sid=${this.config.SessionID}&maxItems=${maxItems}`;
			}
			else if(value !== "")
			{
				url = `${this.config.fsAPIURL}/SET/${command}?pin=${this.config.PIN}&sid=${this.config.SessionID}&value=${value}`;
			}
			else
			{
				url = `${this.config.fsAPIURL}/GET/${command}?pin=${this.config.PIN}&sid=${this.config.SessionID}`;
			}
			this.log.debug(url);
			await axios.get(url)
				.then(data => {
				//log.debug(device.)
					const parser = new xml2js.Parser();
					parser.parseStringPromise(data.data).then(function (result) {
						log.debug(JSON.stringify(result.fsapiResponse));
						answer.result = result.fsapiResponse;
						answer.success = result.fsapiResponse.status[0].toString() == "FS_OK";
					})
						.catch(function (err) {
							// Failed});
							log.debug(JSON.stringify(err));
							log.error("Parse error");
						});
				})
				.catch(function (error)
				{
					if (error.response)
					{
						log.error("Connection error");
						log.debug(JSON.stringify(error));
						adapter.createSession();
					}
				});
		}
		else
		{
			this.log.error("No connection");
		}
		//this.log.debug(JSON.stringify(answer.result));
		return answer;
	}

	async createSession()
	{
		const log = this.log;
		const dev = {};
		log.debug("CreateSession");
		let url;
		let connected = false;
		if(this.config.fsAPIURL !== null)
		{
			url = `${this.config.fsAPIURL}/CREATE_SESSION?pin=${this.config.PIN}`;
			log.debug(url);
			await axios.get(url)
				.then(device => {
				//log.debug(device.)
					const parser = new xml2js.Parser();
					parser.parseStringPromise(device.data).then(function (result) {
						log.debug(result.fsapiResponse.sessionId);
						dev.Session = result.fsapiResponse.sessionId;
						log.debug("Session created");
						connected = true;
						sessionTimestamp = Date.now();
					})
						.catch(function (err) {
							// Failed});
							log.debug(JSON.stringify(err));
							log.debug("No session created");
						});
				})
				.catch(function (error)
				{
					if (error.response)
					{
						log.warn("Falsche PIN?");
						log.warn(JSON.stringify(error));
						return;
					}
				});
			this.config.SessionID = dev.Session;
			//this.config.SessionTS = Date.now();
			await this.setState("info.connection", connected, true);
			if(this.log.level=="debug" || this.log.level=="silly")
			{
				await this.setStateAsync("debug.session", {val: dev.Session, ack: true});
				await this.setStateAsync("debug.sessionCreationTime", { val: sessionTimestamp, ack: true});
			}
			await this.sleep(200);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.message" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }


	async sleep(ms)
	{
		const ts = Date.now();
		return new Promise((resolve) => {
			sleeps.set(ts, resolve);
			setTimeout(resolve, ms);
		});;
	}

	async onFSAPIMessage()
	{
		if(!polling)
		{
			polling = true;
			const adapter = this;
			if(lastSleepClear <= Date.now() - 10 * 60 * 1000)
			{
				lastSleepClear = Date.now();
				adapter.log.debug("Clearing sleeps");
				if(sleeps.size > 0)
					try
					{
						const timers = [ ];
						sleeps.forEach((value, key , sleeps) => 
						{
							if(key <= Date.now() - 900 * 1000)
							{
								clearTimeout(value);
								timers.push(key);
							}
						});
						timers.forEach((value, index, array) => sleeps.delete(index));
					}
					finally {}
			}

			try
			{
				notifyTimestamp = Date.now();
				if(this.log.level=="debug" || this.log.level=="silly")
				{
					this.setStateAsync("debug.lastNotifyCall", { val: notifyTimestamp, ack: true });
				}	
				const result = await this.callAPI("", "", 0, 0, true);
				let variable;
				if(result.success)
				{
					//this.log.debug(JSON.stringify(result.result));
					result.result.notify.forEach(async item => {
						this.log.debug(`Item: ${item.$.node} - ${JSON.stringify(item.value)}`);

						switch (item.$.node)
						{
							case "netremote.sys.state":
								break;
							case "netremote.sys.mode":
								variable = item.value[0].u32[0];
								await this.setStateAsync("modes.selected", { val: Number(variable), ack: true });
								await this.getStateAsync(`modes.${variable}.label`)
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("modes.selectedLabel", { val: result.val, ack: true });
										}
									});
								//adapter.setStateAsync("modes.selectPreset", {val:null, ack: true});
								await this.getModePresets(variable, false);
								await this.UpdatePreset();
								break;
							case "netremote.play.serviceids.ecc":
								break;
							case "netremote.play.info.text":
								await this.setStateAsync("media.text", { val: item.value[0].c8_array[0].trim(), ack: true });
								await this.callAPI("netRemote.play.info.artist")
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("media.artist", { val: result.result.value[0].c8_array[0], ack: true });
										}
									});
								await this.callAPI("netremote.sys.mode")
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("modes.selected", { val: Number(variable), ack: true });
											adapter.getStateAsync(`modes.${variable}.label`)
												.then(function (result) {
													if(result !== null && result !== undefined && result.val !== null )
													{
														adapter.setStateAsync("modes.selectedLabel", { val: result.val, ack: true });
													}
												});
											//adapter.setStateAsync("modes.selectPreset", {val:null, ack: true});
										}
									});
								break;
							case "netremote.play.info.artist":
								await this.setStateAsync("media.artist", { val: item.value[0].c8_array[0].trim(), ack: true });
								break;
							case "netremote.play.info.album":
								await this.setStateAsync("media.album", { val: item.value[0].c8_array[0].trim(), ack: true });
								break;
							case "netremote.play.info.title":
								await this.setStateAsync("media.title", { val: item.value[0].c8_array[0].trim(), ack: true });
								break;
							case "netremote.play.info.name":
								await this.setStateAsync("media.name", { val: item.value[0].c8_array[0].trim(), ack: true });
								await this.callAPI("netRemote.play.info.artist")
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("media.artist", { val: result.result.value[0].c8_array[0], ack: true });
										}
									});
								await this.callAPI("netRemote.play.info.album")
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("media.album", { val: result.result.value[0].c8_array[0], ack: true });
										}
									});
								await this.callAPI("netremote.sys.mode")
									.then(function (result) {
										if(result !== null && result !== undefined && result.val !== null )
										{
											adapter.setStateAsync("modes.selected", { val: Number(variable), ack: true });
											adapter.getStateAsync(`modes.${variable}.label`)
												.then(function (result) {
													if(result !== null && result !== undefined && result.val !== null )
													{
														adapter.setStateAsync("modes.selectedLabel", { val: result.val, ack: true });
													}
												});
											//adapter.setStateAsync("modes.selectPreset", {val:null, ack: true});
										}
									});
								await this.UpdatePreset(item.value[0].c8_array[0].trim());
								break;
							case "netremote.sys.audio.volume":
								await this.setStateAsync("audio.volume", { val: Number(item.value[0].u8[0]), ack: true });
								break;
							case "netremote.sys.audio.mute":
								await this.setStateAsync("audio.mute", { val: item.value[0].u8[0] == 1, ack: true });
								break;
							case "netremote.play.status":
								switch (item.value[0].u8[0])
								{
									// Play
									case "2":
										await this.setStateAsync("media.state", { val: 1, ack: true });
										break;
									// Pause
									case "3":
										await this.setStateAsync("media.state", { val: 0, ack: true });
										break;
									default:
										break;
								}
								break;
							case "netremote.sys.power":
								await this.setStateAsync("device.power", { val: item.value[0].u8[0] == 1, ack: true });
								break;
							case "netremote.play.info.graphicuri":
								await this.setStateAsync("media.graphic", { val: item.value[0].c8_array[0].trim(), ack: true });
								break;
							default:
								break;
						}
					});
					this.callAPI("netRemote.play.info.graphicUri")
						.then(async function (result) {
							await adapter.setStateAsync("media.graphic", { val: result.result.value[0].c8_array[0].trim(), ack: true });
						});
				}
			}
			catch (e)
			{
				adapter.log.error(e.message);
				if(this.log.level=="debug" || this.log.level=="silly")
				{
					await adapter.setStateAsync("debug.lastNotifyError", { val: JSON.stringify(e), ack: true });
				}
			}
			finally
			{
				clearTimeout(timeOutMessage);
				timeOutMessage = setTimeout(() => this.onFSAPIMessage(), this.config.PollIntervall * 1000);
				polling = false;
			}
		}
	}

	async UpdatePreset(name)
	{
		if(name === undefined) return;
		let mode = await this.getStateAsync("modes.selected");
		if(mode !== null && mode !== undefined && mode.val !== null && mode.val !== undefined)
		{
			let hasPresets = await this.getStateAsync(`modes.${mode.val}.presets.available`)
			if(hasPresets !== null && hasPresets !== undefined && hasPresets.val !== null && hasPresets.val !== undefined
				&& hasPresets.val)
			{
				let i = 0;
				while(true)
				{
					const preset = await this.getStateAsync(`modes.${mode.val}.presets.${i}.name`);
					if(preset !== null && preset !== undefined && preset.val !== null && preset.val !== undefined
						&& preset.val !== "")
					{
						if(name === preset.val)
						{
							await this.setStateAsync("modes.selectPreset", { val: i, ack:true});
							break;
						}
						++i;
					}
					else
					{
						await this.setStateAsync("modes.selectPreset", { val: null, ack:true});
						break;
					}
				}
			}
			else
			{
				await this.setStateAsync("modes.selectPreset", { val: null, ack:true});
			}
		}
	}
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new FrontierSilicon(options);
} else {
	// otherwise start the instance directly
	new FrontierSilicon();
}
