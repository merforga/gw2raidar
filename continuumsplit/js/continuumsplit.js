'use strict'

/*

TODO:

Display:
 - Class icons
 - Improve selection display
 
Metrics
 - Focus selection
  - Buffs
 - Phase
 - Single target detail pane
 - Skill log

Graphs
 - DPS 


Maps:
 - High res maps (That_Shaman ?)
 - Map out coords
 [ ] VG
 [ ] Gorse
 [ ] Sab
 [ ] Sloth
 [ ] Matthias
 [ ] KC
 [ ] Xera
 [ ] Cairn
 [ ] Mo
 [ ] Samarog
 [ ] Deimos
 [ ] SH
 [ ] Dhuum
 
Map specific mechanics:

VG:
 - RGB circle
 - Glowing sectors
Gorse:
 - Charging circle
 - Orbs
 - Eggs
Sab:
 - Flame wall
 - Cannon state
 - Bomb
 - Platform health?
Sloth:
 - Mushrooms/poison?
 - Slubling form
 - Fire breath
 - Rock stun
 - Fixate
 - Poison
 - CC phases
Matthias:
 - Poison
 - Afflicted
 - Fountain state
 - Icey patch
 - Tornado
 - Chosen
 - Shield
 - Sacrifice
 - Bombs
 - Hadoken?
KC
 - Statues
 - Statue explosion
 - Fixates
 - Bomb
 - Pizza slices?
 - Outer ring (CM)
Xera
 - Shards
 - Empowered
 - Nuggets
 - Orb eating
 - Wall
Cairn
 - Big arm thing
 - Pushes
 - Black waves
 - Circles? Probably not
 - Stunned
 - Agony
 - Teleport countdown (CM)
Mo
 - Protect/Dispel/Claim
 - Floor state
 - Soldiers/etc
 - Spikes
Samarog
 - Shockwave
 - Thunk
 - Spears
 - Stun
 - Rigom/Galosh
 - Friends
Deimos
 - Up/Down
 - Hands?
 - Slices
 - Oil
 - Tears
 - Bubble
 - Saul health
SH
 - Dead
 - Scythes
 - Shrinking platform
 - Walls
 - Fixate
Dhuum
 - Circle
 - Enforcer
 - Deadling
 - Green circles
 - Suck
 - Upper area/pacman
 - Fissures ? I wish
 - Echo (CM)
 - Bubble (end phase?)
 - pizza
 - bomb
 - shackles
*/

var Replay;
{
	class AreaBox {
		constructor(left, right, top, bottom) {
			this.left = left;
			this.top = top;
			this.right = right;
			this.bottom = bottom;
			this.width = right - left;
			this.height = bottom - top;
		}
	}

	class Point {
		constructor(x, y) {
			this.x = x;
			this.y = y;
			this[0] = x
			this[1] = y
		}		
	}

	class Sprite {
		constructor(image, srcArea) {
			this.image = image;
			this.srcArea = srcArea;
		}
		
		render(context, x, y, size) {
			context.drawImage(this.image, this.srcArea.left, this.srcArea.top, this.srcArea.width, this.srcArea.height, x - 0.5 * size, y - 0.5 * size, size, size);
		}
	}
	
	class PlayerDetail {
		constructor(playerId, playerData, replay, maxDps, maxCleave) {
			playerData.detailDisplay = this;
			
			this.element = $(document.createElement('div'))
			this.element.addClass('replay-detail-row')
			
			let mainBar = $(document.createElement('div'))
			mainBar.addClass('replay-detail-main')
			this.element.append(mainBar);
			
			let classIcon = $(document.createElement('div'))
			classIcon.addClass('replay-class-' + playerData["class"].toLowerCase())
			mainBar.append(classIcon)
			
			let nameDisplay = $(document.createElement('div'))
			nameDisplay.addClass('replay-detail-item')
			nameDisplay.addClass('replay-detail-name')
			nameDisplay.text(playerData["name"])		
			mainBar.append(nameDisplay)
			
			let bossDpsBar = createDisplayBar(maxDps)
			let dpsItem = $(document.createElement('div'))
			dpsItem.addClass('replay-detail-item')
			dpsItem.addClass('replay-detail-dps')
			dpsItem.append(bossDpsBar)
			mainBar.append(dpsItem)
			
			this.setBossDps = function(amount) {
				bossDpsBar.setValue(amount)
			}
						
			let cleaveDpsBar = createDisplayBar(maxCleave)
			let cleaveItem = $(document.createElement('div'))
			cleaveItem.addClass('replay-detail-item')
			cleaveItem.addClass('replay-detail-cleave')
			cleaveItem.append(cleaveDpsBar)
			mainBar.append(cleaveItem)
			
			this.setCleave = function(amount) {
				cleaveDpsBar.setValue(amount)
			}
			
			this.buffsBar = $(document.createElement('div'))
			this.buffsBar.addClass('replay-buff-bar')
			this.buffsBar.addClass('hidden')
			this.element.append(this.buffsBar)
			
			this.buffs = {}
			
			this.setBuff = function(name, amount) {
				if (!this.buffs[name]) {
					let buff = $(document.createElement('div'))
					buff.addClass('replay-buff')
					buff.addClass('replay-buff-' + name)
					let buffCount = $(document.createElement('div'))
					buffCount.addClass('replay-buff-count');
					buffCount.addClass('hidden')
					buff.append(buffCount);
					this.buffsBar.append(buff)
					this.buffs[name] = buff
				}
				
				let buff = this.buffs[name]
				if (amount > 0) {
					buff.toggleClass('hidden', false)
					if (amount > 1) {
						let buffCounter = $(buff.find('.replay-buff-count')[0])
						buffCounter.toggleClass('hidden', false)
						buffCounter.text(amount)
					} else {
						buff.find('.replay-buff-count').toggleClass('hidden', true)
					}
				} else {
					buff.toggleClass('hidden', true)
				}
			}
			
			this.element.on("click", function () {
				replay.selectActor(playerId);
			});
		}
	}
	    
	
	Replay = class {
		constructor(domId, width, height) {
			let replay = this;
			
			// The size to render dots
			this.dotSize = 2
			// The size to render boids
			this.boidSize = 2.5
			// The size to render icons
			this.iconSize = 6
			// Window size (remember for leaving full screen)
			this.windowW = width;
			this.windowH = height;
			// Is the replay currently playing
			this.playing = false
			// Is the replay in fullscreen
			this.fullscreen = false;
			// Current replay time
			this.frameTime = 0
			// Available speeds
			this.speeds = [1, 2, 4, 8]
			// Which speed is selected
			this.speedIndex = 0
			// The portion of width used by the canvas - the rest is for details
			this.canvasPortion = 0.5
			
			// Image providing all the icons
			this.iconsImage = new Image();
			this.iconsImage.onload = function() {
				replay.downSprite = new Sprite(replay.iconsImage, new AreaBox(32, 63, 0, 32))
				replay.deadSprite = new Sprite(replay.iconsImage, new AreaBox(0, 31, 0, 32))
			}
			this.iconsImage.src = "img/icons.png"
							
			// Generate html
			this.rootElement = $(domId)
			this.rootElement.append("<div class='replay-container'>" 
			+ "<div class='replay-main'><div class='replay-display'><canvas class='replay-canvas'></canvas></div>"
			+ "<div class='replay-details'>"
			+ "<div class='replay-detail-bossinfo'><div class='replay-boss-name'></div><div class='replay-boss-health'></div></div>"
			+ "<div class='replay-detail-player-section'>"
			+ "<div class='replay-detail-table'><div class='replay-detail-header-row'><div class='replay-detail-item'></div><div class='replay-detail-item replay-detail-player-column'></div><div class='replay-detail-item replay-detail-boss-dps-column'>Boss DPS</div><div class='replay-detail-item replay-detail-cleave-dps-column'>Cleave DPS</div></div>"
			+ "<div class='replay-detail-player-rows'></div></div></div></div></div>"
			+ "<div class='replay-controls'>"
			+ "<button type='button' class='replay-play'><img src='img/play.png'/></button>"
			+ "<input type='range' class='replay-seekbar' value=0></input>"
			+ "<button type='button' class='replay-speed'>1x</button>"
			+ "<button type='button' class='replay-fullscreen'><img src='img/fullscreen.png'/></button>"
			+ "<div class='replay-times'><div class='replay-current-time'>0:00</div> / <div class='replay-total-time'>0:00</div></div></div>"
			+ "</div>");
			this.rootElement.css("width", width + "px")
					
			// Setup canvas
			this.canvas = this.rootElement.find('.replay-canvas')[0]
			this.canvas.width = width * this.canvasPortion
			this.canvas.height = height
			this.canvas.addEventListener("click", function (event) {
				replay.clicked(event.offsetX, event.offsetY)
			});
			this.context = this.canvas.getContext("2d");
			
			// Setup controls
			this.playButton = this.rootElement.find('.replay-play')
			this.playButton.click( function() {
				replay.togglePlay();
			})
			this.speedButton = this.rootElement.find('.replay-speed')
			this.speedButton.click( function() {
				replay.toggleSpeed();
			})
			this.seekbar = this.rootElement.find('.replay-seekbar')
			this.seekbar.change(function() {
				replay.setFrame(this.valueAsNumber);	
			});
			this.seekbar[0].addEventListener("input", function () { 
				replay.currentTime.text(printTime(this.valueAsNumber))
			});
			this.seekbar.mousedown(function () {
				replay.pauseToSeek = replay.playing;
				replay.pause();
			});
			this.seekbar.mouseup(function() {
				if (replay.pauseToSeek) {
					replay.play();
				}
			});
			
			this.fullscreenButton = this.rootElement.find('.replay-fullscreen')
			this.fullscreenButton.click(function() {
				replay.toggleFullscreen()
			})
			let fullscreenEndHandler = function () {
				if (replay.fullscreen && !document.fullscreenElement && !document.webkitIsFullScreen && !document.mozFullScreen && !document.msFullscreenElement) {
					replay.toggleFullscreen()
				}
			}
			document.addEventListener('fullscreenchange', fullscreenEndHandler)
			document.addEventListener('webkitfullscreenchange', fullscreenEndHandler)
			document.addEventListener('mozfullscreenchange', fullscreenEndHandler)
			document.addEventListener('MSfullscreenchange', fullscreenEndHandler)
			
			this.currentTime = this.rootElement.find('.replay-current-time')
			this.totalTime = this.rootElement.find('.replay-total-time')
			
			this.bossNameDisplay = this.rootElement.find('.replay-boss-name')
			this.playerDetails = this.rootElement.find('.replay-detail-player-rows')
			
			$.get("mapinfo.json", function(data) {
				replay.mapInfo = data;
				if (replay.replayData != null) {
					replay.loadReplayData(replay.replayData)
				}
			});
			
		}
		
		/***************************************
		 *	Load Replay
		 **************************************/
		
		loadReplay(replayUrl) {
			let replay = this;
			replay.replayData = null;
			$.get(replayUrl, function(data) {
				replay.replayData = data;
				if (replay.mapInfo != null) {
					replay.loadReplayData(data);
				}
			});
		}
		
		loadReplayData(replayData) {
			this.replayData = replayData;
			this.setupTracks(replayData.tracks);
			this.addPlayerDetailRows(replayData['base-state'])
			let replay = this;
			let maps = this.mapInfo[replayData.info.encounter];

			replay.maps = []
			
			$.each(maps, function(index, mapData) {
				let map = {"ready" : false}
				replay.maps.push(map)
				map.image = new Image();
				map.image.onload = function() {
					map.ready = true;
					replay.checkReplayReady();
				}
				map.image.src = mapData.image;
				map.coords = new AreaBox(mapData.worldCoords.left, mapData.worldCoords.right, mapData.worldCoords.top, mapData.worldCoords.bottom)
				map.imageSrc = new AreaBox(mapData.imageCoords.left, mapData.imageCoords.right, mapData.imageCoords.top, mapData.imageCoords.bottom)
				map.imageDst = replay.calcDstBox(map, index, maps.length)
				if (mapData.heightRange != null) {
					map.heightRange = {"min" : mapData.heightRange.min, "max" : mapData.heightRange.max}
				}
			});
			this.duration = this.replayData.info.duration
			this.seekbar.attr("max", this.duration)
			this.totalTime.text(printTime(Math.trunc(this.duration)))
			this.currentTime.text(printTime(0))
			this.bossNameDisplay.text(this.replayData.info.encounter)
		}
		
		checkReplayReady() {
			let replay = this;
			let ready = true;
			// Need all  the maps loaded 
			$.each(this.maps, function(index, map) {
				if (!map.ready) {
					ready = false;
				}
			})
			if (ready) {
				this.ready = true;
				this.setFrame(0);
			}
		}
		
		addPlayerDetailRows(actorData) {
			let maxDps = this.calculateMaxDamage("cleavedamage")
			console.log("MaxDps: " + maxDps);
			
			let replay = this;
			this.playerDetails.html("")
			replay.detailsLookup = {}
			$.each(actorData, function(name, data) {
				if (data["type"] == "Player") {
					let playerDetail = new PlayerDetail(name, data, replay, maxDps, maxDps)
					replay.playerDetails.append(playerDetail.element)
					replay.detailsLookup[name] = playerDetail;
				} else if (data["type"] == "Boss") {
					if (data["health"] != null) {
						let bossHealthDisplay = createDisplayBar(100) 
						bossHealthDisplay.setValue(100)
						replay.rootElement.find('.replay-boss-health').append(bossHealthDisplay);
						data.healthDisplay = bossHealthDisplay
					}
				}
			})
		}
		
		calculateMaxDamage(targetTrack) {
			let replay = this;
			let max = 0;
			$.each(this.replayData.tracks, function(trackIndex, track) {
				if (targetTrack == track.path[1]) {
					$.each(track.data, function(index, dataPair) {
						if (dataPair.time > 5) {
							let value = dataPair.value / dataPair.time;
							if (value > max) {
								max = value;
							}
						}
					})
				}
			});
			return max;
		}
		

		
		// Private: Configures tracks after load
		setupTracks(tracks) {
			let replay = this
			$.each(tracks, function(index, track) {
				track['end-time'] = track['start-time'] + (track.data.length - 1) * track.frequency
				switch (track['interpolation']) {
					case 'lerp':
						track.sampleFunc = lerp
						break;
					case 'slerp':
						track.sampleFunc = slerp
						break;
					default:
						track.sampleFunc = floor
				}
				
				switch (track['update-type']) {
					case 'delta':
						track.lastTime = 0
						track.lastFrame = 0
						track.calcFrame = Replay.deltaTrackCalculator
						break;
					default:
						track.calcFrame = Replay.interpolatingTrackCalculator
				}
			})
		}
			
		/******************************************************************************
		*
		* Replay Controls
		*
		******************************************************************************/
			
		toggleFullscreen() {
			let replay = this
			if (this.fullscreen) {
				this.fullscreen = false
				if (document.exitFullscreen) {
					document.exitFullscreen();
				} else if (document.webkitExitFullscreen) {
					document.webkitExitFullscreen();
				} else if (document.mozCancelFullScreen) {
					document.mozCancelFullScreen();
				} else if (document.msExitFullscreen) {
					document.msExitFullscreen();
				} else {
					console.log("Fullscreen exit not supported")
				}
				this.canvas.width = this.windowW * this.canvasPortion
				this.canvas.height = this.windowH
				this.rootElement.css("width", this.windowW)
				
				$('.replay-buff-bar').toggleClass('hidden', true)
				
				$.each(this.maps, function(index, map) {
					map.imageDst = replay.calcDstBox(map, index, replay.maps.length)
				});
				this.setFrame(this.frameTime)
			} else {

				let replayRoot = this.rootElement[0]
				if (replayRoot.requestFullscreen) {
					replayRoot.requestFullscreen();
				} else if (replayRoot.webkitRequestFullscreen) {
					replayRoot.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
				} else if (replayRoot.mozRequestFullScreen) {
					replayRoot.mozRequestFullScreen();
				} else if (replayRoot.msRequestFullscreen) {
					replayRoot.msRequestFullscreen();
				} else {
					console.log("Fullscreen not supported")
					return
				}
				this.fullscreen = true
				this.canvas.width = window.innerWidth * this.canvasPortion
				this.canvas.height = window.innerHeight;
				this.rootElement.css("width", window.innerWidth)
				$.each(this.maps, function(index, map) {
					map.imageDst = replay.calcDstBox(map, index, replay.maps.length)
				});
				
				$('.replay-buff-bar').toggleClass('hidden', false)
				
				this.setFrame(this.frameTime)
			}
		}
		
		toggleSpeed() {
			this.speedIndex = (this.speedIndex + 1) % this.speeds.length
			this.speedButton.text(this.speeds[this.speedIndex] + 'x')
		}

		togglePlay() {
			if (this.playing) {
				this.pause();
			} else {
				this.play();
			}
		}
		
		pause() {
			if (this.playing) {
				this.playing = false
				this.playButton.toggleClass('replay-pause', false);
				this.playButton.toggleClass('replay-play', true);
				this.playButton.children("img").attr("src", "img/play.png")
			}
		}
		
		play() {
			if (!this.playing && this.ready && this.frameTime < this.duration) {
				let replay = this
				this.lastTime = null;
				this.playing = true;
				this.playButton.toggleClass('replay-pause', true);
				this.playButton.toggleClass('replay-play', false);
				this.playButton.children("img").attr("src", "img/pause.png")
				window.requestAnimationFrame(function (time) {replay.playFrame(time)})
			}
		}
		
	/*********************************************************
    *
    * Animation
    *
    *********************************************************/	
		
		// Plays a the next frame, based on the passage of time
		playFrame(globalTime) {
			if (this.lastTime == null) {
				this.lastTime = globalTime;
			}
			if (this.playing) {
				let newTime = this.frameTime + (globalTime - this.lastTime) * 0.001 * this.speeds[this.speedIndex]
				this.setFrame(newTime)
			}
			this.lastTime = globalTime;
			if (this.frameTime > this.duration) {
				this.pause();
			}
			if (this.playing) {
				let replay = this
				window.requestAnimationFrame(function (time) {replay.playFrame(time)})
			} 
		}
		
		// Sets the frame to a specific point
		setFrame(time) {
			this.generateFrame(time)
			this.renderFrame()
			this.updateDetails()
			this.currentTime.text(printTime(this.frameTime))
			this.seekbar.val(Math.trunc(time))
		}
		
		// Generates data for a specific frame
		generateFrame(time) {
			let frameData = $.extend(true, {}, this.replayData["base-state"]);
			$.each(this.replayData.tracks, function(index, track) {
				track.calcFrame(time, frameData)
			})
			this.frame = frameData
			this.frameTime = time
		}
		
		// Renders the current frame
		renderFrame() {
			let replay = this;
			
			this.context.clearRect(0,0,this.canvas.width, this.canvas.height);
			this.context.fillStyle="#000000";
			this.context.fillRect(0,0,this.canvas.width, this.canvas.height);
			$.each(this.maps, function(index, map) {
				replay.context.drawImage(map.image, map.imageSrc.left, map.imageSrc.top, map.imageSrc.width, map.imageSrc.height, map.imageDst.left, map.imageDst.top, map.imageDst.width, map.imageDst.height);
			});
					
			
			$.each(this.frame, function(name, data) {
				if (data.position == null) {
					return;
				}
				let map = replay.findMap(data.position);
				let scale = replay.getScale(map);
				let pos = replay.convertCoords(map, data.position.x, data.position.y)
				switch (data.state) {
					case 'Down':
						replay.downSprite.render(replay.context, pos.x, pos.y, replay.iconSize * scale);
						break;
					case 'Dead':
						replay.deadSprite.render(replay.context, pos.x, pos.y, replay.iconSize * scale);
						break;
					default:
						let color = data.color
						replay.context.fillStyle=color;
						replay.context.beginPath()			
						if (data.heading != null) {						
							let headingX = Math.sin(data.heading)
							let headingY = Math.cos(data.heading)
							let headingX1 = Math.sin(data.heading + 0.8 * Math.PI)
							let headingY1 = Math.cos(data.heading + 0.8 * Math.PI)
							let headingX2 = Math.sin(data.heading - 0.8 * Math.PI)
							let headingY2 = Math.cos(data.heading - 0.8 * Math.PI)
							replay.context.moveTo(pos.x + scale * replay.boidSize * headingX, pos.y + scale * replay.boidSize * headingY)
							replay.context.lineTo(pos.x + scale * replay.boidSize * headingX1, pos.y + scale * replay.boidSize * headingY1)
							replay.context.lineTo(pos.x + scale * replay.boidSize * headingX2, pos.y + scale * replay.boidSize * headingY2)
							replay.context.closePath()
						} else {
							replay.context.arc(pos.x, pos.y, replay.dotSize * scale, 0, 2 * Math.PI, false)
						}

						replay.context.fill()
				}
			});
			
			if (this.selected) {
				let map = this.findMap(this.frame[this.selected].position)
				let scale = this.getScale(map)
				let pos = replay.convertCoords(map, this.frame[this.selected].position.x, this.frame[this.selected].position.y)
				this.context.beginPath()			
				this.context.lineWidth=scale * 0.4;
				this.context.strokeStyle="#FFFFFF";
				this.context.arc(pos.x, pos.y, replay.boidSize * scale, 0, 2 * Math.PI, false)
				this.context.stroke()
			}
		}
		
		// Updates the details pane to the current frame
		updateDetails() {
			let frameTime = this.frameTime
			$.each(this.frame, function(name, data) {
				if (data.healthDisplay != null && data.health != null) {
					data.healthDisplay.setValue(data.health.toFixed(2))
				}
				if (data.detailDisplay != null) {
					if (frameTime > 0) {
						data.detailDisplay.setBossDps(Math.trunc(parseInt(data["bossdamage"]) / frameTime))
						data.detailDisplay.setCleave(Math.trunc(parseInt(data["cleavedamage"]) / frameTime))
					} else {
						data.detailDisplay.setBossDps(0)
						data.detailDisplay.setCleave(0);
					}
					$.each(data.buff, function(name, value) {
						data.detailDisplay.setBuff(name, value);
					})
				}
			})
			
			let newSort = this.playerDetails.children().sort(function(a, b) {
				return parseInt($(b).find('.replay-detail-dps').text()) - parseInt($(a).find('.replay-detail-dps').text());
			});
			
			let matches = true;
			for (let i = 0; i < newSort.length; ++i) {
				if (newSort[i] != this.playerDetails.children()[i]) {
					matches = false;
					break;
				}
			}
			if (!matches) {
				newSort.appendTo(this.playerDetails);
			}
		}
		
		// Determines the map to use for a specific position (mostly for multi-level arenas
		findMap(pos) {
			let map = null;
			if (this.maps.length == 1) {
				map = this.maps[0];
			} else {
				$.each(this.maps, function(index, mapData) {
					if (pos.z > mapData.heightRange.min && pos.z < mapData.heightRange.max) {
						map = mapData
						return;
					}
				})
			}
			return map
		}
					
		// Get the scale for rendering on the given map
		getScale(map) {
			return 30 * map.imageDst.width / Math.abs(map.coords.width);
		}
		
		// Calculate the destination area for a map, given a number of maps. Currently maps render in a vertical column
		calcDstBox(map, mapNumber, numberOfMaps) {
			let availableHeight = this.canvas.height / numberOfMaps
			let imageScale = (map.imageSrc.right - map.imageSrc.left) / (map.imageSrc.bottom - map.imageSrc.top);
			let canvasScale = this.canvas.width / availableHeight;
			let offsetX = 0
			let offsetY = 0
			let width = 0
			let height = 0
			if (canvasScale > imageScale) {
				width = Math.trunc(imageScale * availableHeight);
				height = availableHeight;
				offsetX = Math.trunc((this.canvas.width - width) / 2.0)
			} else {
				width = this.canvas.width;
				height = Math.trunc(1 / imageScale * this.canvas.width);
				offsetY = Math.trunc((availableHeight - height) / 2.0)
			}
			offsetY += mapNumber * availableHeight
			
			return new AreaBox(offsetX, offsetX + width, offsetY, offsetY + height)
		}

		// Convert coords to canvas position
		convertCoords(map, x, y) {
			return new Point(
				(x - map.coords.left) / map.coords.width * map.imageDst.width + map.imageDst.left,
				(y - map.coords.top) / map.coords.height * map.imageDst.height + map.imageDst.top
			)
		}
				
		/*****************************************************************************************
        *
        * Actor Selection
        *
        *****************************************************************************************/		
				
	    // If the player clicked on an actor, select it
		clicked(x, y) {
			let map = this.getMapFromCanvasPos(x,y)
			if (map == null) {
				this.selected = null;
			} else {
				let rangeSqrd = this.getScale(map) * this.getScale(map) * this.dotSize * this.dotSize;
				let closest = null;
				let closestDist = rangeSqrd;
				let replay = this;
				$.each(this.frame, function(name, data) {
					if (data.position == null) {
						return;
					}
					if (map.heightRange != null && (data.position.z < map.heightRange.min || data.position.z > map.heightRange.max)) {
						return;
					}
					let pos = replay.convertCoords(map, data.position.x, data.position.y)
					let relDist = distSqrd(pos.x,pos.y,x, y)
					if (relDist < closestDist) {
						closest = name;
						closestDist = relDist;
					}
				});
				
				this.selectActor(closest);
				this.selected = closest;
			}
			
			if (!this.playing) {
				this.renderFrame();
			}
		}
		
		selectActor(actorId) {
			let oldSelection = this.detailsLookup[this.selected];
			if (oldSelection) {
				oldSelection.element.removeClass('replay-selected');
			}
			this.selected = actorId;
			let newSelection = this.detailsLookup[actorId]
			if (newSelection) {
				newSelection.element.addClass('replay-selected');
			}
			if (!this.playing) {
				this.renderFrame()
			}
			
		}
		
		getMapFromCanvasPos(x,y) {
			let result = null;
			let replay = this;
			$.each(this.maps, function(index, map) {
				if (map.imageDst.left <= x && map.imageDst.right > x && map.imageDst.top <= y && map.imageDst.bottom > y) {
					result = map;
				}
			})
			return result;
		}
		
		/************************************************
		*
		* Track Functions
		*
		*************************************************/
		
		static deltaTrackCalculator(time, frameData) {
			let target = generatePath(frameData, this.path)
			let item = this.path[this.path.length - 1]
			if (this.data[this.data.length - 1].time < time) {
				target[item] = this.data[this.data.length - 1].value
			} else if (time > this.data[0].time){
				let firstIndex = 0;
				while (this.data[firstIndex].time < time) {
					firstIndex++;
				}
				let timeRange = this.data[firstIndex].time - this.data[firstIndex - 1].time
				let t = (time - this.data[firstIndex - 1].time) / timeRange;
				
				target[item] = this.sampleFunc(this.data[firstIndex - 1].value, this.data[firstIndex].value, t)
			}
		}

		static seriesTrackCalculator(time, frameData) {
			let target = generatePath(frameData, this.path)
			let item = this.path[this.path.length - 1]
					
			if (time > this['end-time']) {
				target[item] = this.data[this.data.length - 1]
			} else if (time > this['start-time']){
				let normalisedTime = (time - this['start-time']) / this['frequency']
				let startIndex = Math.trunc(normalisedTime)
				let endIndex = Math.ceil(normalisedTime)
				let startValue = this.data[Math.trunc(normalisedTime)]
				targetItem = this.sampleFunc(this.data[startIndex], this.data[endIndex], normalisedTime - startIndex)
			}
		}
		
	}
	
	/**********************************************
	 *
	 * Display Bars
	 *
	 * These are the dps meter style bar controls
	 *
	 *********************************************/

	function createDisplayBar(maxValue) {
		let barRoot = $(document.createElement('div'))
		barRoot.addClass('replay-bar-background')
		let barFill = $(document.createElement('div'))
		barFill.addClass('replay-bar')
		let barLabel = $(document.createElement('div'))
		barLabel.addClass('replay-bar-label')
		
		barRoot.append(barFill)
		barRoot.append(barLabel)
		barRoot.setValue = function(value) {
			barFill.value = value
			barFill.text(value)
			barFill.css('clip-path', "inset(0% " + (100 - 100 * value / maxValue) + '% 0% 0%)')
			barLabel.text(value)
		}
		
		return barRoot;
	}
	
	function decodeUnicode(s) {
		return decodeURIComponent(JSON.parse('"' + s + '"'));
	}
	
	function floor(a, b, t) {
		return a
	}
	
	function lerp(a, b, t) {
		return a + (b - a) * t
	}
	
	function distSqrd(x1, y1, x2, y2) {
		return (x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1);
	}
	
	// Circular interpolation
	function slerp(a, b, t) {
		if (a - b > Math.PI) {
			let result = lerp(a, b + 2 * Math.PI, t) 
			if (result > 2 * Math.PI) {
				result -= 2 * Math.PI
			}
			return result
		} else if (b - a > Math.PI) {
			let result = lerp(a + 2 * Math.PI, b, t) 
			if (result > 2 * Math.PI) {
				result -= 2 * Math.PI
			}
			return result
		} else {
			return lerp(a, b, t)
		}
	}

	function printTime(time) {
		return Math.trunc(time / 60) + ':' + stringPadLeft(Math.trunc(time % 60), '0', 2);
	}

	function stringPadLeft(str, pad, length) {
		return (new Array(length+1).join(pad)+str).slice(-length);
	}
	
	// Given a path (a list of strings) creates an object chain in object corresponding to the path for any part that is missing, minus the last value in the path. Returns the end object.
	// The intended use is along the lines of
	//
	// target = generatePath(root, path);
	// target[path[path.length - 1]] = value;
	//
	// To insert a value at the end of the path.
	function generatePath(object, path) {
		let target = object
		$.each(path.slice(0, path.length - 1), function(index, part) {
			if (!(part in target)) {
				target[part] = {}
			}
			target = target[part]
		});
		return target;
	}
}
