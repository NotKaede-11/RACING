// Add this to the top of game.js
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Error caught: ", message, "at line", lineno);
  return true;
};

// Intro Scene - properly encapsulated as a class
class IntroScene extends Phaser.Scene {
  constructor() {
    super('intro');
  }
  
  preload() {
    // No assets to preload for intro scene
  }
  
  create() {
    // Create black background
    this.add.rectangle(400, 300, 800, 600, 0x000000);
        
    // Add story text
    this.add.text(400, 300, 'Chrono Drift: You stole a time rig.\nThe enforcers want it back.\nOutrun them—or be erased.', {
      fontSize: '24px',
      color: '#ffffff',
      align: 'center',
      lineSpacing: 10
    }).setOrigin(0.5);
        
    // Add a skip message
    this.add.text(400, 500, 'Press SPACE to start', {
      fontSize: '18px',
      color: '#ffffff'
    }).setOrigin(0.5);
        
    // Transition to game scene after 5 seconds
    this.timerEvent = this.time.delayedCall(5000, () => {
      this.scene.start('game');
    });
        
    // Allow skipping the intro with spacebar
    this.input.keyboard.once('keydown-SPACE', () => {
      if (this.timerEvent) this.timerEvent.remove();
      this.scene.start('game');
    });
  }
}

// Game Scene - fully encapsulated with no globals
class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
    
    // *** MOVED GLOBAL VARIABLES HERE AS CLASS PROPERTIES ***
    this.player = null;
    this.cursors = null;
    this.keys = null;
    this.speed = 0;
    this.fuel = 100;
    this.fuelText = null;
    this.fuelCans = null;
    this.maxSpeed = 300;
    this.acceleration = 10;
    this.deceleration = 5;
    this.turnSpeed = 0.006;
    
    // Existing class properties
    this.prevX = 0;
    this.prevY = 0;
    this.distanceTraveled = 0;
    this.fuelBarWidth = 200;
    this.fuelBarHeight = 20;
    this.isGameOver = false;
    this.lastAngle = 0;
    this.isSlowed = false;
    this.slowTimer = null;
    
    // Road generation properties
    this.roadSegments = [];
    this.segmentLength = 600;
    this.roadWidth = 400;
    this.laneWidth = 100;
    this.visibleSegmentsAhead = 10;
    this.visibleSegmentsBehind = 3;

    // Player lives system
    this.playerLives = 3;

    // Track which explosions have already caused damage
    this.damagedByExplosions = [];
  }
  
  preload() {
    // Nothing to preload, we'll create textures at runtime
  }
  
  create() {
    console.log("Game scene started");
    
    // Create car texture using graphics
    if (!this.textures.exists('car')) {
      const carGraphics = this.add.graphics();
      carGraphics.fillStyle(0xff0000, 1);
      carGraphics.fillRect(0, 0, 30, 15);
      carGraphics.fillStyle(0xadd8e6, 1);
      carGraphics.fillRect(5, 3, 20, 9);
      carGraphics.fillStyle(0x000000, 1);
      carGraphics.fillRect(0, 0, 2, 15);
      carGraphics.fillRect(28, 0, 2, 15);
      
      carGraphics.generateTexture('car', 30, 15);
      carGraphics.destroy();
    }
    
    // Create textures for traffic cars
    if (!this.textures.exists('trafficCar')) {
      const trafficCarGraphics = this.add.graphics();
      trafficCarGraphics.fillStyle(0x0000ff, 1); // Blue cars
      trafficCarGraphics.fillRect(0, 0, 30, 15);
      trafficCarGraphics.fillStyle(0xadd8e6, 1);
      trafficCarGraphics.fillRect(5, 3, 20, 9);
      trafficCarGraphics.fillStyle(0x000000, 1);
      trafficCarGraphics.fillRect(0, 0, 2, 15);
      trafficCarGraphics.fillRect(28, 0, 2, 15);
      
      trafficCarGraphics.generateTexture('trafficCar', 30, 15);
      trafficCarGraphics.destroy();
    }
    
    // Set a starting position in the left lane
    const laneX = 400 - (this.roadWidth/2) + (this.roadWidth/2 + this.laneWidth/2);
    const startPosition = { x: laneX, y: 500, angle: -90 };
    
    // Add player car - ensure it's visible
    this.player = this.physics.add.sprite(startPosition.x, startPosition.y, 'car');
    this.player.setOrigin(0.5, 0.5);
    this.player.angle = startPosition.angle;
    this.player.setDepth(10);
    this.player.setCollideWorldBounds(false);
    this.player.body.setSize(25, 12, true);
    
    // Add traffic cars
    this.trafficCars = this.physics.add.group();
    this.spawnTrafficCars(8);
    
    // Add collisions between traffic cars
    this.physics.add.collider(
      this.trafficCars, 
      this.trafficCars, 
      this.handleTrafficCollision, 
      null, 
      this
    );
    
    // Player collision with traffic cars
    this.physics.add.overlap(
      this.player, 
      this.trafficCars, 
      this.hitTrafficCar, 
      function(player, car) {
        const overlapX = Math.abs(player.x - car.x);
        const overlapY = Math.abs(player.y - car.y);
        return (overlapX < 15 && overlapY < 8);
      }, 
      this
    );
    
    // Camera setup to follow player
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setFollowOffset(0, 150);
    
    // Initialize highway system
    this.initHighway();
    
    // Initialize position tracking for fuel consumption
    this.prevX = this.player.x;
    this.prevY = this.player.y;
    
    // Set up keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    
    // Initialize fuel - note using this.fuel now
    this.fuel = 100;
    
    // Create fuel bar with high depth value
    this.fuelBarBackground = this.add.rectangle(110, 20, this.fuelBarWidth, this.fuelBarHeight, 0x333333)
      .setScrollFactor(0)
      .setDepth(1000);
    this.fuelBarBackground.setOrigin(0, 0.5);
    
    this.fuelBar = this.add.rectangle(110, 20, this.fuelBarWidth, this.fuelBarHeight - 2, 0x00ff00)
      .setScrollFactor(0)
      .setDepth(1000);
    this.fuelBar.setOrigin(0, 0.5);
    
    this.fuelText = this.add.text(10, 20, 'Fuel:', { fontSize: '20px', color: '#fff' })
      .setScrollFactor(0)
      .setDepth(1000);
    this.fuelText.setOrigin(0, 0.5);
    
    // Spawn fuel cans
    this.fuelCans = this.physics.add.group();
    this.spawnFuelCans(3);
    this.physics.add.overlap(this.player, this.fuelCans, this.collectFuel, null, this);
    
    // Set up oil spills group
    this.oilSpills = this.physics.add.group();
    this.physics.add.overlap(this.player, this.oilSpills, this.hitOilSpill, null, this);
    
    // Add debris group
    this.debris = this.physics.add.group();
    this.physics.add.overlap(this.player, this.debris, this.hitDebris, null, this);
    
    // Initialize last angle
    this.lastAngle = startPosition.angle;

    // Add lives display
    this.livesGroup = this.add.group();
    this.updateLivesDisplay();
    
    // Reset game over flag
    this.isGameOver = false;
  }
  
  initHighway() {
    // Create initial road segments
    this.roadGroup = this.add.group();
    this.buildingsGroup = this.add.group();
    this.collisionGroup = this.physics.add.staticGroup();
    
    // Generate initial segments
    const playerSegmentY = Math.floor(this.player.y / this.segmentLength) * this.segmentLength;
    for (let i = -this.visibleSegmentsBehind; i <= this.visibleSegmentsAhead; i++) {
      this.createRoadSegment(playerSegmentY + (i * this.segmentLength));
    }
  }
  
  createRoadSegment(segmentY) {
    // Create road base (asphalt)
    const road = this.add.rectangle(
      400,
      segmentY,
      this.roadWidth, 
      this.segmentLength,
      0x444444
    );
    
    // Add center dividing line (yellow)
    const centerLine = this.add.rectangle(
      400, 
      segmentY,
      10,
      this.segmentLength,
      0xFFFF00
    );
    
    // Track all game objects in this segment
    const segmentObjects = [road, centerLine];
    
    // Add lane markings
    const leftLaneMarkers = this.createDashedLine(400 - this.laneWidth, segmentY, this.segmentLength, 0xFFFFFF);
    const rightLaneMarkers = this.createDashedLine(400 + this.laneWidth, segmentY, this.segmentLength, 0xFFFFFF);
    
    // Add ALL dashed line markers to the segment objects
    segmentObjects.push(...leftLaneMarkers, ...rightLaneMarkers);
    
    // Add buildings and track their objects
    const leftBuildings = this.createBuildings(400 - (this.roadWidth/2) - 100, segmentY, -1);
    const rightBuildings = this.createBuildings(400 + (this.roadWidth/2) + 100, segmentY, 1);
    
    // Add invisible walls for collision - adjust width to be narrower
    const leftWall = this.physics.add.existing(
      this.add.rectangle(400 - (this.roadWidth/2) - 20, segmentY, 20, this.segmentLength, 0xFF0000, 0),
      true
    );
    const rightWall = this.physics.add.existing(
      this.add.rectangle(400 + (this.roadWidth/2) + 20, segmentY, 20, this.segmentLength, 0xFF0000, 0),
      true
    );
    
    // Add to collision group
    this.collisionGroup.add(leftWall);
    this.collisionGroup.add(rightWall);
    
    segmentObjects.push(leftWall, rightWall);
    
    // Add segment to tracking array with ALL objects
    this.roadSegments.push({
      y: segmentY,
      gameObjects: segmentObjects
    });
    
    this.roadGroup.add(road);
    this.roadGroup.add(centerLine);
  }
  
  createDashedLine(x, segmentY, length, color) {
    const dashLength = 40;
    const gapLength = 20;
    const totalDashes = Math.floor(length / (dashLength + gapLength));
    const dashObjects = [];
    
    for (let i = 0; i < totalDashes; i++) {
      const dash = this.add.rectangle(
        x,
        segmentY - (length/2) + (i * (dashLength + gapLength)) + (dashLength/2),
        3,
        dashLength,
        color
      );
      dashObjects.push(dash);
      this.roadGroup.add(dash);
    }
    
    return dashObjects;
  }
  
  createBuildings(x, segmentY, side) {
    // Generate 3-5 buildings per side per segment
    const buildingCount = Phaser.Math.Between(3, 5);
    const segmentSpacing = this.segmentLength / buildingCount;
    
    // Add more variety to buildings
    const buildingTypes = [
      // Tall skyscraper
      { minHeight: 150, maxHeight: 250, minWidth: 40, maxWidth: 70 },
      // Wide office building
      { minHeight: 80, maxHeight: 120, minWidth: 80, maxWidth: 120 },
      // Small house
      { minHeight: 50, maxHeight: 70, minWidth: 40, maxWidth: 60 },
      // Medium building
      { minHeight: 100, maxHeight: 150, minWidth: 50, maxWidth: 90 }
    ];
    
    for (let i = 0; i < buildingCount; i++) {
      // Select random building type
      const buildingType = Phaser.Utils.Array.GetRandom(buildingTypes);
      
      const buildingHeight = Phaser.Math.Between(buildingType.minHeight, buildingType.maxHeight);
      const buildingWidth = Phaser.Math.Between(buildingType.minWidth, buildingType.maxWidth);
      
      // More variety in positioning
      const buildingY = segmentY - (this.segmentLength/2) + (i * segmentSpacing) + 
                        Phaser.Math.Between(5, segmentSpacing - 10);
      
      // More variety in colors
      const buildingColors = [0x888888, 0x666666, 0x555555, 0x444444, 0x333333, 0x777777, 0x999999];
      const buildingColor = Phaser.Utils.Array.GetRandom(buildingColors);
      
      // Create building with more variation
      const building = this.add.rectangle(
        x + Phaser.Math.Between(-20, 20), 
        buildingY,
        buildingWidth,
        buildingHeight,
        buildingColor
      );
      
      // Add windows with more variety
      this.addBuildingWindows(x + Phaser.Math.Between(-20, 20), buildingY, buildingWidth, buildingHeight);
      
      this.buildingsGroup.add(building);
    }
  }
  
  addBuildingWindows(x, y, width, height) {
    const windowSize = 8;
    const padding = 15;
    
    const cols = Math.floor((width - padding*2) / (windowSize + padding));
    const rows = Math.floor((height - padding*2) / (windowSize + padding));
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Only add window with 70% probability for variety
        if (Math.random() > 0.3) {
          const windowX = x - (width/2) + padding + (col * (windowSize + padding)) + (windowSize/2);
          const windowY = y - (height/2) + padding + (row * (windowSize + padding)) + (windowSize/2);
          
          const window = this.add.rectangle(
            windowX,
            windowY,
            windowSize,
            windowSize,
            0xFFFF88 // Light yellow for windows
          );
          
          this.buildingsGroup.add(window);
        }
      }
    }
  }
  
  spawnFuelCans(count) {
    for (let i = 0; i < count; i++) {
      // Position fuel cans on the road - can be in any lane
      const laneIndex = Phaser.Math.Between(0, 3); // 4 lanes (0-3)
      
      // Define lane centers precisely like we did for traffic cars
      const laneCenters = [
        this.roadWidth/4 - this.laneWidth/2,        // Far left lane
        this.roadWidth/4 + this.laneWidth/2,        // Middle left lane
        this.roadWidth/2 + this.laneWidth/2,        // Middle right lane
        this.roadWidth/2 + this.laneWidth + this.laneWidth/2  // Far right lane
      ];
      
      const laneX = 400 - (this.roadWidth/2) + laneCenters[laneIndex];
      const y = this.player.y - Phaser.Math.Between(600, 1800); // Ahead of player
      
      const can = this.add.rectangle(laneX, y, 20, 20, 0x00ff00);
      this.physics.add.existing(can);
      can.body.setImmovable(true);
      
      this.fuelCans.add(can);
    }
  }
  
  spawnTrafficCars(count) {
    for (let i = 0; i < count; i++) {
      // Define lane centers precisely
      const laneCenters = [
        this.roadWidth/4 - this.laneWidth/2,        // Far left lane
        this.roadWidth/4 + this.laneWidth/2,        // Middle left lane
        this.roadWidth/2 + this.laneWidth/2,        // Middle right lane
        this.roadWidth/2 + this.laneWidth + this.laneWidth/2  // Far right lane
      ];
      
      // Ensure equal distribution across all lanes
      let laneIndex;
      if (i < 4 && count >= 4) {
        // For initial spawns, ensure one car per lane
        laneIndex = i;
      } else {
        // For subsequent spawns, randomize
        laneIndex = Phaser.Math.Between(0, 3);
      }
      
      const laneX = 400 - (this.roadWidth/2) + laneCenters[laneIndex];
      
      // Position car ahead of player or behind based on lane
      let y;
      let angle;
      let speed;
      
      if (laneIndex < 2) {
        // Cars in opposite lanes move down (towards player)
        y = this.player.y - Phaser.Math.Between(1800, 3000);
        angle = 90;
        speed = Phaser.Math.Between(100, 200);
      } else {
        // Cars in same direction move up (away from player)
        y = this.player.y + Phaser.Math.Between(600, 1200);
        angle = -90;
        speed = Phaser.Math.Between(50, 150);
      }
      
      // Add extra safety check for texture existence
      if (!this.textures.exists('trafficCar')) {
        console.error("Traffic car texture missing - recreating");
        this.createCarTextures();
        return;
      }
      
      // Create the car with properly applied texture
      const car = this.physics.add.sprite(laneX, y, 'trafficCar');
      
      // Check if car was created properly
      if (!car) {
        console.error("Failed to create traffic car");
        continue;
      }
      
      car.angle = angle;
      car.setData('speed', speed);
      car.setData('laneIndex', laneIndex);
      car.setData('laneX', laneX);
      car.setDepth(10);
      
      // Set a more precise hitbox for the car
      car.body.setSize(25, 12, true);
      
      this.trafficCars.add(car);
      
      // Add visual debug indicator for each car
      car.name = "Car_" + Date.now() + "_" + i; // Unique identifier
      console.log("Created car:", car.name, "at position", laneX, y);
    }
  }

  debugLaneDistribution() {
    // Count cars in each lane
    const laneCounts = [0, 0, 0, 0];
    
    this.trafficCars.getChildren().forEach(car => {
      const laneIndex = car.getData('laneIndex');
      if (laneIndex >= 0 && laneIndex <= 3) {
        laneCounts[laneIndex]++;
      }
    });
    
    console.log("Cars per lane:", laneCounts);
  }

  createCarTextures() {
    // Car texture
    const carGraphics = this.add.graphics();
    carGraphics.fillStyle(0xff0000, 1);
    carGraphics.fillRect(0, 0, 30, 15);
    carGraphics.fillStyle(0xadd8e6, 1);
    carGraphics.fillRect(5, 3, 20, 9);
    carGraphics.fillStyle(0x000000, 1);
    carGraphics.fillRect(0, 0, 2, 15);
    carGraphics.fillRect(28, 0, 2, 15);
    carGraphics.generateTexture('car', 30, 15);
    carGraphics.destroy();
    
    // Traffic car texture
    const trafficCarGraphics = this.add.graphics();
    trafficCarGraphics.fillStyle(0x0000ff, 1);
    trafficCarGraphics.fillRect(0, 0, 30, 15);
    trafficCarGraphics.fillStyle(0xadd8e6, 1);
    trafficCarGraphics.fillRect(5, 3, 20, 9);
    trafficCarGraphics.fillStyle(0x000000, 1);
    trafficCarGraphics.fillRect(0, 0, 2, 15);
    trafficCarGraphics.fillRect(28, 0, 2, 15);
    trafficCarGraphics.generateTexture('trafficCar', 30, 15);
    trafficCarGraphics.destroy();
  }

  getCarAhead(car) {
    const laneIndex = car.getData('laneIndex');
    const direction = laneIndex < 2 ? 1 : -1;
    let nearestCar = null;
    let minDistance = Number.MAX_VALUE;
    
    this.trafficCars.getChildren().forEach(otherCar => {
      if (car === otherCar || otherCar.getData('laneIndex') !== laneIndex) {
        return;
      }
      
      const distance = direction === 1 ? 
                      (otherCar.y - car.y) : 
                      (car.y - otherCar.y);
      
      if (distance > 0 && distance < minDistance) {
        minDistance = distance;
        nearestCar = otherCar;
      }
    });
    
    return nearestCar;
  }

  createRecklessDriver() {
    if (this.trafficCars.getChildren().length < 5) {
      return;
    }
    
    const cars = this.trafficCars.getChildren();
    const randomCar = Phaser.Utils.Array.GetRandom(cars);
    
    if (!randomCar.getData('isReckless')) {
      randomCar.setData('isReckless', true);
      
      const currentSpeed = randomCar.getData('speed');
      randomCar.setData('speed', currentSpeed * 1.5);
      
      randomCar.setTint(0xff0000);
      
      this.time.delayedCall(5000, () => {
        if (randomCar.active) {
          randomCar.setData('isReckless', false);
          randomCar.clearTint();
        }
      });
    }
  }

  updateTrafficCars() {
    // Occasionally create a reckless driver
    if (Math.random() < 0.01) {
      this.createRecklessDriver();
    }
    
    this.trafficCars.getChildren().forEach(car => {
      const speed = car.getData('speed');
      const laneIndex = car.getData('laneIndex');
      const targetX = car.getData('laneX');
      
      if (Math.abs(car.x - targetX) > 2) {
        car.x += (targetX - car.x) * 0.05;
      }
      
      if (!car.getData('isReckless')) {
        const carAhead = this.getCarAhead(car);
        if (carAhead) {
          const safeDistance = 100;
          const direction = laneIndex < 2 ? 1 : -1;
          
          const distance = direction === 1 ? 
                          (carAhead.y - car.y) : 
                          (car.y - carAhead.y);
          
          if (distance < safeDistance && distance > 0) {
            const slowdownFactor = distance / safeDistance;
            car.setData('speed', carAhead.getData('speed') * slowdownFactor);
          }
        }
      }
      
      if (laneIndex < 2) {
        car.y += car.getData('speed') * (1/60);
      } else {
        car.y -= car.getData('speed') * (1/60);
      }
      
      if (car.y > this.player.y + 1500 || car.y < this.player.y - 3000) {
        car.destroy();
        this.spawnTrafficCars(1);
      }
    });
  }

  handleTrafficCollision(car1, car2) {
    const midX = (car1.x + car2.x) / 2;
    const midY = (car1.y + car2.y) / 2;
    
    const debrisCount = Phaser.Math.Between(4, 8);
    
    for (let i = 0; i < debrisCount; i++) {
      const offsetX = Phaser.Math.Between(-25, 25);
      const offsetY = Phaser.Math.Between(-25, 25);
      
      const debrisSize = Phaser.Math.Between(5, 15);
      
      const debrisColors = [0x333333, 0x555555, 0x777777, 0x222222];
      const debrisColor = Phaser.Utils.Array.GetRandom(debrisColors);
      
      let debris;
      if (Math.random() > 0.5) {
        debris = this.add.rectangle(
          midX + offsetX, 
          midY + offsetY, 
          debrisSize, 
          debrisSize, 
          debrisColor
        );
      } else {
        debris = this.add.circle(
          midX + offsetX, 
          midY + offsetY, 
          debrisSize / 2, 
          debrisColor
        );
      }
      
      this.physics.add.existing(debris);
      debris.body.setImmovable(true);
      
      debris.setData('debrisType', 'carPart');
      debris.setData('hitByPlayer', false);
      
      this.debris.add(debris);
    }
    
    this.tweens.add({
      targets: [car1, car2],
      alpha: 0.3,
      duration: 100,
      yoyo: true,
      repeat: 3
    });
    
    if (Math.random() < 0.3) {
      if (Math.random() < 0.5) {
        car1.destroy();
        this.spawnTrafficCars(1);
      } else {
        car2.destroy();
        this.spawnTrafficCars(1);
      }
    }
  }

  hitTrafficCar(player, trafficCar) {
    if (!this.isGameOver) {
      this.tweens.add({
        targets: player,
        alpha: 0.5,
        duration: 100,
        yoyo: true,
        repeat: 3,
        onComplete: () => {
          this.gameOver("You crashed your time rig!");
        }
      });
    }
  }
  
  hitOilSpill(player, oilSpill) {
    // Only apply effect if we're not already slowed and this oil hasn't been hit
    if (!this.isSlowed && !oilSpill.getData('hitByPlayer')) {
      oilSpill.setData('hitByPlayer', true);
      
      // Slow the player temporarily
      this.isSlowed = true;
      const originalSpeed = this.speed;
      this.speed *= 0.6; // Reduce speed by 40%
      
      // Visual effect on oil spill
      oilSpill.setAlpha(0.3); // Make more transparent
      
      // Reset speed after delay and remove oil
      this.slowTimer = this.time.delayedCall(1200, () => {
        this.isSlowed = false;
        if (this.speed > 0) {
          this.speed = originalSpeed;
        }
        
        this.time.delayedCall(1000, () => {
          if (oilSpill.active) {
            oilSpill.destroy();
          }
        });
      });
    }
  }

  createRandomExplosion() {
    const cars = this.trafficCars.getChildren();
    if (cars.length < 3) return;
    
    const visibleCars = cars.filter(car => {
      return car.y > this.player.y - 400 && car.y < this.player.y + 300 && car.x > 100 && car.x < 700;
    });
    
    if (visibleCars.length === 0) return;
    
    const explodingCar = Phaser.Utils.Array.GetRandom(visibleCars);
    
    if (explodingCar && !explodingCar.getData('isExploding')) {
      explodingCar.setData('isExploding', true);
      
      const explosionID = Date.now() + "_" + Math.floor(Math.random() * 1000);
      
      this.tweens.add({
        targets: explodingCar,
        alpha: 0.3,
        duration: 100,
        yoyo: true,
        repeat: 5,
        onComplete: () => {
          const explosion = this.add.circle(
            explodingCar.x,
            explodingCar.y,
            40, 
            0xff6600,
            0.8
          );
          
          this.tweens.add({
            targets: explosion,
            scale: 1.5,
            alpha: 0,
            duration: 500,
            onComplete: () => {
              explosion.destroy();
            }
          });
          
          const debrisCount = Phaser.Math.Between(10, 15);
          
          for (let i = 0; i < debrisCount; i++) {
            const offsetX = Phaser.Math.Between(-60, 60);
            const offsetY = Phaser.Math.Between(-60, 60);
            
            const debrisSize = Phaser.Math.Between(5, 15);
            
            const debrisColors = [0x333333, 0x555555, 0x777777, 0xff3300, 0xff6600];
            const debrisColor = Phaser.Utils.Array.GetRandom(debrisColors);
            
            let debris;
            if (Math.random() > 0.5) {
              debris = this.add.rectangle(
                explodingCar.x + offsetX, 
                explodingCar.y + offsetY, 
                debrisSize, 
                debrisSize, 
                debrisColor
              );
            } else {
              debris = this.add.circle(
                explodingCar.x + offsetX, 
                explodingCar.y + offsetY, 
                debrisSize / 2, 
                debrisColor
              );
            }
            
            this.physics.add.existing(debris);
            debris.body.setImmovable(true);
            
            debris.setData('explosionID', explosionID);
            debris.setData('debrisType', 'explosion');
            debris.setData('hitByPlayer', false);
            
            this.debris.add(debris);
          }
          
          explodingCar.destroy();
          this.spawnTrafficCars(1);
        }
      });
    }
  }

  hitDebris(player, debris) {
    if (!debris.getData('hitByPlayer')) {
      debris.setData('hitByPlayer', true);
      
      const isExplosionDebris = debris.getData('debrisType') === 'explosion';
      const explosionID = debris.getData('explosionID');
      
      const originalSpeed = this.speed;
      
      if (isExplosionDebris) {
        this.speed *= 0.7;
        
        this.tweens.add({
          targets: player,
          alpha: 0.5,
          duration: 100,
          yoyo: true,
          repeat: 2
        });
        
        if (explosionID && !this.damagedByExplosions.includes(explosionID)) {
          this.damagedByExplosions.push(explosionID);
          
          this.playerLives--;
          console.log("Hit explosion debris! Lives remaining:", this.playerLives);
          
          const lifeDisplay = this.livesGroup.getChildren()[this.playerLives];
          if (lifeDisplay) {
            this.tweens.add({
              targets: lifeDisplay,
              alpha: 0.3,
              duration: 100,
              yoyo: true,
              repeat: 5
            });
          }
          
          this.updateLivesDisplay();
          
          if (this.playerLives <= 0) {
            this.gameOver("Your time rig was damaged beyond repair!");
          }
        }
      } else {
        this.speed *= 0.85;
      }
      
      debris.setAlpha(0.5);
      
      this.time.delayedCall(1000, () => {
        if (this.speed > 0 && !this.isGameOver) {
          this.speed = Math.min(originalSpeed, this.speed * 1.15);
        }
      });
      
      this.time.delayedCall(3000, () => {
        if (debris && debris.active) {
          debris.destroy();
        }
      });
    }
  }

  updateLivesDisplay() {
    this.livesGroup.clear(true, true);
    
    for (let i = 0; i < this.playerLives; i++) {
      const lifeIcon = this.add.rectangle(
        700 - (i * 30), 20, 
        20, 20, 
        0xff0000
      ).setScrollFactor(0).setDepth(1000);
      
      this.livesGroup.add(lifeIcon);
    }
  }
  
  update() {
    // Early return if game is over
    if (this.isGameOver) {
      return;
    }
    
    // Check for fuel depletion FIRST
    if (this.fuel <= 0) {
      this.fuel = 0;
      this.speed = 0;
      this.player.setVelocity(0, 0);
      this.gameOver("Your time rig ran out of fuel!");
      return;
    }
    
    // Update fuel bar width based on current fuel percentage
    this.fuelBar.width = (this.fuel / 100) * this.fuelBarWidth;
    
    // Update road segments
    this.updateRoadSegments();
    
    // Update traffic cars
    this.updateTrafficCars();
    
    // Check for collision with road boundaries
    this.physics.collide(this.player, this.collisionGroup);
    
    // Check for sharp turns to create oil spills
    const angleDiff = Math.abs(this.player.angle - this.lastAngle);
    if (angleDiff > 6 && this.speed > 100) {
      const oil = this.add.circle(this.player.x, this.player.y, 15, 0x000000, 0.7);
      this.physics.add.existing(oil);
      oil.body.setImmovable(true);
      oil.setData('hitByPlayer', false);
      this.oilSpills.add(oil);
      
      if (this.oilSpills.getChildren().length > 20) {
        const oldest = this.oilSpills.getChildren()[0];
        oldest.destroy();
      }
    }
    
    // Update last angle for next frame
    this.lastAngle = this.player.angle;
    
    // Calculate distance moved since last frame
    const dx = this.player.x - this.prevX;
    const dy = this.player.y - this.prevY;
    const distanceThisFrame = Math.sqrt(dx * dx + dy * dy);
    
    // Update total distance and reduce fuel based on distance
    this.distanceTraveled += distanceThisFrame;
    
    // Reduce fuel by 1% for every 50 pixels moved
    if (this.speed !== 0) {
      this.fuel -= distanceThisFrame / 50;
    }
    
    // Update previous position for next frame
    this.prevX = this.player.x;
    this.prevY = this.player.y;
    
    // Change color based on fuel level
    if (this.fuel < 20) {
      this.fuelBar.fillColor = 0xff0000;
    } else if (this.fuel < 50) {
      this.fuelBar.fillColor = 0xffff00;
    } else {
      this.fuelBar.fillColor = 0x00ff00;
    }
    
    // Handle movement controls
    if (this.cursors.up.isDown || this.keys.up.isDown) {
      this.speed = Math.min(this.speed + this.acceleration, this.maxSpeed);
    } else if (this.cursors.down.isDown || this.keys.down.isDown) {
      this.speed = Math.max(this.speed - this.acceleration, -this.maxSpeed / 2);
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(this.speed - this.deceleration, 0);
      } else if (this.speed < 0) {
        this.speed = Math.min(this.speed + this.deceleration, 0);
      }
    }
    
    // Handle turning
    if (this.cursors.left.isDown || this.keys.left.isDown) {
      this.player.angle -= this.turnSpeed * (this.speed !== 0 ? Math.abs(this.speed) : 50);
    }
    if (this.cursors.right.isDown || this.keys.right.isDown) {
      this.player.angle += this.turnSpeed * (this.speed !== 0 ? Math.abs(this.speed) : 50);
    }
    
    // Calculate velocity based on car's angle and speed
    const angleRad = Phaser.Math.DegToRad(this.player.angle);
    this.player.setVelocity(
      Math.cos(angleRad) * this.speed,
      Math.sin(angleRad) * this.speed
    );
    
    // Call this every 5 seconds to check lane distribution
    if (this.time.now % 5000 < 20) {
      this.debugLaneDistribution();
    }
    
    // Add small chance of random car explosion (0.1% per frame)
    if (Math.random() < 0.001) {
      this.createRandomExplosion();
    }
  }
  
  updateRoadSegments() {
    // Get current player segment
    const playerSegmentY = Math.floor(this.player.y / this.segmentLength) * this.segmentLength;
    
    // Check if we need to create new segments ahead
    let furthestSegmentY = this.getFurthestSegmentY();
    
    // Debug logging to check road generation values
    console.log('Player Y:', this.player.y, 'Player Segment Y:', playerSegmentY, 'Furthest Y:', furthestSegmentY);
    
    // Make sure we always have plenty of road ahead
    const desiredSegmentsAhead = 10;
    
    // Calculate how many segments we need to create
    // Remember lower Y value means "ahead" since car drives upward (negative Y direction)
    const distanceToFurthest = playerSegmentY - furthestSegmentY;
    const neededSegments = desiredSegmentsAhead - Math.floor(distanceToFurthest / this.segmentLength);
    
    // Create new segments ahead with a safety limit
    const maxSegmentsPerFrame = 5;
    const segmentsToCreate = Math.min(Math.max(0, neededSegments), maxSegmentsPerFrame);
    
    console.log('Need to create:', segmentsToCreate, 'segments');
    
    // Create the required segments
    for (let i = 0; i < segmentsToCreate; i++) {
      // Create a new segment ahead (lower Y position)
      const newSegmentY = furthestSegmentY - this.segmentLength;
      this.createRoadSegment(newSegmentY);
      
      // Update furthestSegmentY for next iteration
      furthestSegmentY = newSegmentY;
    }
    
    // Only remove segments that are VERY far behind
    const behindThreshold = playerSegmentY + (this.visibleSegmentsBehind * 2 * this.segmentLength);
    
    for (let i = this.roadSegments.length - 1; i >= 0; i--) {
      if (this.roadSegments[i].y > behindThreshold) {
        // Remove this segment
        this.roadSegments[i].gameObjects.forEach(obj => obj.destroy());
        this.roadSegments.splice(i, 1);
      }
    }
    
    // Check if we need more fuel cans
    if (this.fuelCans.getChildren().length < 3) {
      this.spawnFuelCans(1);
    }
    
    // Remove fuel cans too far behind
    this.fuelCans.getChildren().forEach(can => {
      if (can.y > this.player.y + 800) {
        can.destroy();
      }
    });
    
    // Remove debris that's too far behind the player
    this.debris.getChildren().forEach(debris => {
      if (debris.y > this.player.y + 800) {
        debris.destroy();
      }
    });
  }
  
  getFurthestSegmentY() {
    let minY = Infinity;
    this.roadSegments.forEach(segment => {
      if (segment.y < minY) {
        minY = segment.y;
      }
    });
    return minY;
  }
  
  collectFuel(player, can) {
    this.fuel += 30;
    if (this.fuel > 100) this.fuel = 100;
    can.destroy();
    
    // Spawn a new fuel can ahead
    this.spawnFuelCans(1);
  }

  gameOver(reason = "Your time rig ran out of fuel!") {
    // Prevent multiple game over screens
    if (this.isGameOver) return;
    
    this.isGameOver = true;
    
    // Stop the car
    this.speed = 0;
    this.player.setVelocity(0, 0);
    
    // Create overlay and game over text
    const overlay = this.add.rectangle(
      0, 0, this.cameras.main.width * 2, this.cameras.main.height * 2,
      0x000000, 0.7
    )
    .setScrollFactor(0)
    .setDepth(2000);
    
    overlay.setOrigin(0, 0);
    
    const gameOverText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 - 30,
      'GAME OVER',
      { fontSize: '48px', color: '#ff0000', fontStyle: 'bold' }
    )
    .setScrollFactor(0)
    .setDepth(2001);
    gameOverText.setOrigin(0.5);
    
    const restartText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 + 30,
      'Press SPACE to restart',
      { fontSize: '24px', color: '#ffffff' }
    )
    .setScrollFactor(0)
    .setDepth(2001);
    restartText.setOrigin(0.5);
    
    // Now our restart works without errors since all state is properly encapsulated
    this.input.keyboard.once('keydown-SPACE', () => {
      // Simply restart the current scene for a clean new game
      this.scene.restart();
    });
  }
}

// Game configuration
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: [IntroScene, GameScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  backgroundColor: '#888888'
};

// Initialize game - NO GLOBAL VARIABLES!
const game = new Phaser.Game(config);
