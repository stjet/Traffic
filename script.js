class Canvas {
  constructor(size, id) {
    this.size = size;
    this.canvas = document.createElement("CANVAS");
    this.canvas.id = this.id;
    this.canvas.width = size[0];
    this.canvas.height = size[1];
    document.body.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.components = [];
    this.events = {};
    this.frame = 0;
    //modifications
    this.show_crash = false;
    this.crash_vanish = true;
  }
  update() {
    this.frame += 1;
    this.clear();
    if (this.light_handler) {
      this.light_handler(this.components.filter(function(i) {return i.constructor.name == "Light"}), this.components.filter(function(i) {return i.constructor.name == "Car" && i.show && !Car.true_off_canvas(i.coords, canvas) }));
    }
    for (var i=0; i < this.components.length; i++) {
      this.components[i].update();
    }
  }
  clear() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  addEvent(event, objects) {
    this.events[event] = objects;
    //add components to the event separately
    let self = this;
    this.canvas.addEventListener(event, function(e) {
      for (let i=0; i < self.events[event].length; i++) {
        let component = self.events[event][i];
        //call function in component that handles the event (eg: Car.onclick() is Car['onclick'](). e parameter is the event data)
        component[event](e);
      }
    })
  }
}

class Crash {
  constructor(canvas, coords) {
    //a lane, a turn, or a transfer from one lane to another. should allow the cars to move on it
    this.canvas = canvas;
    //first coord should be start, second be end. in direction cars are going
    this.coords = coords;
    //hand around for 20 frames
    this.permeance = 25;
    this.start = JSON.parse(JSON.stringify(canvas.frame));
    this.canvas.components.push(this);
  }
  update() {
    if (this.canvas.frame < this.permeance+this.start) {
      this.canvas.context.beginPath();
      this.canvas.context.arc(this.coords[0], this.coords[1], 25, 0, 2 * Math.PI, false);
      this.canvas.context.fillStyle = 'red';
      this.canvas.context.fill();
    } else {
      //remove self from components
      this.destroy();
    }
  }
  destroy() {
    this.canvas.components.splice(this.canvas.components.indexOf(this), 1);
  }
}

class Light {
  constructor(canvas, state, show=false, coords=[0,0]) {
    this.canvas = canvas;
    this.coords = coords;
    this.state = state;
    this.show = show;
    switch (this.state) {
      case "go":
        this.color = "green";
        break;
      case "slow":
        this.color = "yellow";
        break;
      case "stop":
        this.color = "red";
        break;
    }
    canvas.components.push(this);
  }
  click(e) {
    if (this.canvas.context.isPointInPath(this.path, e.offsetX, e.offsetY)) {
      //change state
      let states = ["go","slow","stop"];
      let index = states.indexOf(this.state)+1;
      if (index > states.length-1) {
        index = 0;
      }
      this.state = states[index];
    }
  }
  update() {
    if (this.state == "go") {
      this.color = "green";
    } else if (this.state == "slow") {
      this.color = "yellow";
    } else if (this.state == "stop") {
      this.color = "red";
    }
    if (!this.show) {
      return
    }
    let path = new Path2D();
    //this.canvas.context.beginPath();
    path.arc(this.coords[0], this.coords[1], 10, 0, 2 * Math.PI);
    this.canvas.context.fillStyle = this.color;
    this.canvas.context.fill(path);
    this.path = path;
  }
}

class Car {
  //canvas is canvas class
  constructor(canvas, direction, show=false, coords=[0,0]) {
    this.canvas = canvas;
    this.coords = coords;
    this.show = show;
    this.direction = direction;
    switch (this.direction) {
      case "up":
        this.angle = 0;
        break;
      case "down":
        this.angle = 180;
        break;
      case "left":
        this.angle = 270;
        break;
      case "right":
        this.angle = 90;
        break;
      case "upleft":
        this.angle = 315;
        break;
      case "upright":
        this.angle = 45;
        break;
      case "downleft":
        this.angle = 225;
        break;
      case "downright":
        this.angle = 135;
        break;
    }
    this.path = undefined;
    this.goal = undefined;
    this.forward = true;
    this.turning = false;
    this.left_hardcode = -3;
    this.right_hardcode = 2;
    this.speed = 0;
    this.speed_limit = 19;
    this.color = ['red', 'blue', 'green', "black", "lightgreen", "aquamarine", "gray", "orange"][Math.floor(Math.random()*8)];
    this.angle_change = 0;
    //a car is in front and stopping the car
    this.blocking = false;
    canvas.components.push(this);
  }
  static distance(p1, p2) {
    return Math.sqrt(Math.abs(p1[0]-p2[0])**2+Math.abs(p1[1]-p2[1]))
  }
  static point_in_rect(p, rect) {
    //rect: [[x,y], int, [x,y]]
    //upper left point, rotation angle, center
    //car width: 20 car length: 30
    let coords = [rect[0]];
    coords.push([rect[0][0], rect[0][1]+30]);
    coords.push([rect[0][0]+20, rect[0][1]+30]);
    coords.push([rect[0][0]+20, rect[0][1]]);
    //rotation fixing coords
    let actual_coords = [];
    function degrees_to_radians(deg) {
      return deg*Math.PI/180
    }
    for (let i=0; i < coords.length; i++) {
      let center = rect[2];
      let angle = degrees_to_radians(rect[1]);
      let offset_coords = [coords[i][0]-center[0], coords[i][1]-center[1]];
      let y = offset_coords[1]*Math.cos(angle)-offset_coords[0]*Math.sin(angle);
      let x = offset_coords[1]*Math.sin(angle)+offset_coords[0]*Math.cos(angle);
      actual_coords.push([center[0]+x,center[1]+y]);
    }
    //actual bounds checking (cast ray from point, see how many times boundries touched)
    //first, find the equations (and domain) for each side
    //then, for each of the equations, find what x they intersect, and then see is they match the domain
    //count how many intersections. if odd, then inside, if even (or 0), then outside
    //equation for ray [point, [700, point y]]
    let ray = [p, [700, p[1]]];
    let intersections = 0;
    for (let j=0; j < actual_coords.length; j++) {
      let coord1 = actual_coords[j];
      let coord2 = actual_coords[j+1];
      if (j+1 > actual_coords.length-1) {
        coord2 = actual_coords[0];
      }
      if (coord1[0] == coord2[0]) {
        //equation is x=coord1[0]
        //ray y is in between
        //also make sure ray y is on the left side of the line
        if (ray[0][0] > coord1[0]) {
          continue;
        }
        if (coord1[1] > coord2[1]) {
          if (coord2[1] <= ray[0][1] && ray[0][1] <= coord1[1]) {
            intersections += 1;
          }
        } else {
          if (coord1[1] <= ray[0][1] && ray[0][1] <= coord2[1]) {
            intersections += 1;
          }
        }
      } else if (coord1[1] == coord2[1]) {
        //y=
        if (coord1[1] == ray[0][1]) {
          //check to make sure the point is to the left 
          if (coord1[0] < coord2[0]) {
            if (coord1[0] <= ray[0][0] && coord2[0] >= ray[0[0]]) {
              intersections += 1;
            }
          } else {
            if (coord2[0] <= ray[0][0] && coord1[0] >= ray[0[0]]) {
              intersections += 1;
            }
          }
        }
      } else {
        //mx+b is line equation
        //m = (y2-y1)/(x2-x1)
        let m = (coord2[1]-coord1[1])/(coord2[0]-coord1[0]);
        //b = y1-m*x1
        let b = coord1[1]-m*coord1[0];
        //check where line intersects with ray
				//y=mx+b
				//y-b=mx
				//(y-b)/m=x
				//line equation is correct
        let x = (ray[0][1]-b)/m;
				//must make sure line not to the left of ray x
				if (x < ray[0][0]) {
					continue;
				}
				//DEBUG: THERE ARE STILL SOME INACURACIES
        if (coord1[0] < coord2[0]) {
					if (coord1[0] <= x && x <= coord2[0]) {
						intersections += 1;
					}
				} else {
					if (coord2[0] <= x && x <= coord1[0]) {
						intersections += 1;
					}
				}
      }
    }
    //if even
    if (intersections % 2 == 0) {
      return false
    } else {
      return true
    }
  }
  get_closest_direction() {
    //I should probably explain this: to find what direction the car is in, we find the differences between the direction angles (facing up is 0 degrees, for example), then, we want to absolute value it, as some values may be negative, then find the the smallest value (which is the one with the smallest difference). If the difference is the same, it defaults to the first one it finds (in order of 'up', 'down', 'left', 'right'). Then, we find the index of the smallest one and use it to return the direction. However, this doesn't work in between 270 and 360 because we have it as 0. So, we must put a special rule, if it is between 270 and 360, we will use 360-true_angle instead of 0-true_angle. There's probably a more elegant solution but this is what I came up with in the moment. You're welcome future self - Prussia
    //PS: the ... in front of diffs in the Math.min function basically turns the arrays into individual params because thats what Math.min wants (example: Math.min(1,2,3))
    //PPS: true_angle converts negative angles into the positive equivalent. -90 would become 270 and so on
    let true_angle = this.angle;
    if (true_angle <= 0) {
      true_angle += 360;
    }
    let diffs = [Math.abs(0-true_angle), Math.abs(315-true_angle), Math.abs(45-true_angle), Math.abs(180-true_angle), Math.abs(225-true_angle), Math.abs(135-true_angle), Math.abs(270-true_angle), Math.abs(90-true_angle)];
    if (270 <= true_angle && true_angle <= 360) {
      diffs[0] = Math.abs(360-true_angle);
    }
    return ['up', 'upleft', 'upright', 'down', 'downleft', 'downright', 'left', 'right'][diffs.indexOf(Math.min(...diffs))]
  }
  off_canvas() {
    if (this.coords[0]+45 < 0 || this.coords[0]-45 > this.canvas.canvas.width || this.coords[1]+45 < 0 || this.coords[1]-45 > this.canvas.canvas.height) {
      //if (coords[0]+45 < 0 || coords[0]-45 > canvas.canvas.width || coords[1]+45 < 0 || coords[1]-45 > canvas.canvas.height) {}
      return true
    }
    return false
  }
  static at_canvas_edge(coords, canvas) {
    if (coords[0]-30 < 0 || coords[0]+30 > canvas.canvas.width || coords[1]+30 < 0 || coords[1]-30 > canvas.canvas.height) {
      return true
    }
    return false
  }
  static true_off_canvas(coords, canvas) {
    if (coords[0] <= 0 || coords[0] >= canvas.canvas.width || coords[1] <= 0 || coords[1] >= canvas.canvas.height) {
      return true
    }
    return false
  }
  get_center() {
    return [(this.coords[0]+(this.coords[0]+20))/2, (this.coords[1]+(this.coords[1]+30))/2]
  }
  accelerate() {
    this.speed += 2;
    if (this.speed > this.speed_limit) {
      this.speed = this.speed_limit;
    }
  }
  decelerate() {
    this.speed -= 3;
    if (this.speed < 0) {
      this.speed = 0;
    }
  }
  turnLeft() {
    this.angle_change = -2;
    if (this.angle < -360) {
      this.angle = 0;
    }
  }
  turnRight() {
    this.angle_change = 2;
    if (this.angle > 360) {
      this.angle = 0;
    }
  }
  inCollision() {
    //iterate through the other cars, check if they are close, if so check if they are inside current car. if so, return true, else return false
    for (var e=0; e < this.canvas.components.length; e++) {
      if (this.canvas.components[e].constructor.name == "Car") {
        if (this.canvas.components[e].show && this.canvas.components[e] != this) {
          //rect: [[x,y], int, [x,y]]
          //upper left point, rotation angle, center
          if (Car.point_in_rect(this.canvas.components[e].get_center(), [this.coords, this.angle, this.get_center()])) {
            return {success: true, car: this.canvas.components[e]}
          }
        }
      }
    }
    return {success: false}
  }
  car_in_front() {
    //BUG: IF ON LEFT OR RIGHT LANE THIS IS NOT FIRING WHEN IT SHOULD
    for (let car_num=0; car_num < this.canvas.components.length; car_num++) {
        if (this.canvas.components[car_num].constructor.name == "Car") {
          //check if car is on same lane
          if (this.canvas.components[car_num].show && this.canvas.components[car_num].path == this.path && this.canvas.components[car_num] != this) {
            //make sure car is in front
            let c1 = this.get_center();
            let c2 = this.canvas.components[car_num].get_center();
            //in front means car we are checking for is in front, not current car
            let in_front = false;
            switch (this.path.direction) {
              case "up":
                //if in front, y value would be lesser
                in_front = c1[1] > c2[1];
                break;
              case "down":
                //if in front, y value would be greater
                in_front = c1[1] < c2[1];
                break;
              case "left":
                //if in front, x value would be lesser
                in_front = c1[0] > c2[0];
                break;
              case "right":
                //if in front, x value would be greater
                in_front = c1[0] < c2[0];
                break;
            }

            if (in_front) {
              let closeness = Car.distance(c1, c2);
              //if too close, stop the car
              if (closeness < 55 && (this.direction == "left" || this.direction == "right")) {
                //also check if car in front is slower than car
                return {success: true, speed: this.canvas.components[car_num].speed};
              } else if (closeness < 8) {
                return {success: true, speed: this.canvas.components[car_num].speed};
              }
            }
          }
        }
    }
    return {success: false, speed: 0}
  }
  car_on_same_lane_blocking() {
    //also check if car in front is slower than car
    let in_front = this.car_in_front();
    if (in_front.speed < this.speed && in_front.success) {
      //stop the car!
      return true
    }
    return false
  }
  destroy() {
    this.show = false;
    this.canvas.components.splice(this.canvas.components.indexOf(this), 1);
  }
  update() {
    if (this.off_canvas()) {
      this.destroy();
      console.log('boom');
    }
    if (!this.show) {
      return
    }
    //if crashed
    let collision = this.inCollision();
    if (collision.success && !Car.at_canvas_edge(this.get_center(), this.canvas)) {
      this.canvas.crash_counter += 1;
      //add crash
      if (this.canvas.crash_vanish) {
        this.destroy();
        //console.log(collision.car)
        collision.car.destroy();
      }
      console.log('boom');
      if (this.canvas.show_crash) {
        new Crash(this.canvas, this.get_center());
      }
    }
    //here, do actions for car to reach destination
    //starting from this.path, figure out way to transfer to this.goal using this.path.connections. once we are near the coords of the point of connection, change from moving forward to turning. once transferred to another path, switch back to moving forward
    let light_stop = false;
    let transfer_to;
    let distance;
    if ((this.path != this.goal) && this.goal) {
      for (var connections_index=0; connections_index < this.path.connections.length; connections_index++) {
        //we only go one layer deep in this case because thats all we need and im lazy
        if (this.path.connections[connections_index].connections.includes(this.goal)) {
          transfer_to = this.path.connections[connections_index];
          break;
        }
      }
      if (!transfer_to) {
        return
      }
      distance = Car.distance(transfer_to.coords[0], this.get_center());
      if (distance < 5 && this.forward) {
        this.forward = false;
        this.turning = true;
        //handle traffic lights for turns. what a pain.
        let light_name = this.path.direction+this.goal.direction;
        let light = this.canvas.lights[light_name];
        if (light.state == "stop") {
          this.forward = false;
          this.turning = false;
          this.speed = 0;
          light_stop = true;
        } else if (light.state == "slow") {
          //this.turning = true;
          if (this.speed > 4) {
            this.decelerate();
          }
        } else {
          //this.turning = true;
          this.accelerate();
        }
      } else if (distance < 5) {
        //handles traffic lights for turns?
        let light_name = this.path.direction+this.goal.direction;
        let light = this.canvas.lights[light_name];
        if (light.state == "stop") {
          this.forward = false;
          this.turning = false;
          this.speed = 0;
          light_stop = true;
        } else if (light.state == "slow") {
          //if slow for turn, stop for a couple frames
          if (!this.turn_slow) {
            this.speed = 0;
            this.turning = false;
            this.turn_slow_start = JSON.parse(JSON.stringify(this.canvas.frame));
          } else {
            if (this.canvas.frame+15 > this.turn_slow_start) {
              this.accelerate()
              this.turning = true;
            }
          }
          this.turn_slow = true;
        } else {
          this.turning = true;
          this.accelerate();
        }
      }
    } else if (this.path == this.goal) {
      //handles traffic lights if going straight. Nice and simple
      distance = Car.distance(this.path.connections[0].coords[0], this.get_center());
      if (distance < 5) {
        let light = this.canvas.lights[this.path.direction];
        if (light.state == "stop") {
          this.forward = false;
          this.speed = 0;
          light_stop = true;
        } else if (light.state == "slow") {
          this.decelerate();
        } else {
          this.forward = true;
        }
      }
    }
    //add collision detection and slowing down and stuff here later.
    //this.inCollision()
    //if on same lane, do not crash.
    if (!this.turning && !light_stop) {
      if (this.car_on_same_lane_blocking()) {
        this.turning = false;
        this.forward = false;
        this.speed = 0;
        this.blocking = true;
      }
    }
    if (!this.car_in_front().success && this.blocking && !this.turning && !light_stop) {
      //no car, revert to previous state
      this.forward = true;
    }
    /**/
    if (this.forward) {
      if (this.speed < 10) {
        this.accelerate();
      }
    } else if (this.turning) {
      if (this.speed > 8) {
        this.decelerate();
      }
      //calculate amount needed to turn and go forward using speed and 90 degrees as well as distance
      //check if car has reached end of transfer
      distance = Car.distance(transfer_to.coords[2], this.get_center());
      if (distance < 20) {
        //set angle to lane angle
        this.angle = {'up': 0, 'right': 90, 'down': 180, 'left': 270}[this.goal.direction];
        this.turning = false;
        this.forward = true;
      }
      //hard coded angle turns
      if ((transfer_to.direction == "upleft" && this.path.direction == "up") || (transfer_to.direction == "downright" && this.path.direction == "down") || (transfer_to.direction == "upright" && this.path.direction == "right") || (transfer_to.direction == "downleft" && this.path.direction == "left")) {
        //this.turnLeft()
        this.angle_change = this.left_hardcode;
      } else if ((transfer_to.direction == "upright" && this.path.direction == "up") || (transfer_to.direction == "downleft" && this.path.direction == "down") || (transfer_to.direction == "upleft" && this.path.direction == "left") || (transfer_to.direction == "downright" && this.path.direction == "right")) {
        //this.turnRight()
        this.angle_change = this.right_hardcode;
      }
      /*
      this.canvas.context.fillStyle = "red";
      this.canvas.context.fillRect(transfer_to.coords[2][0], transfer_to.coords[2][1], 3, 3);
      */
    }
    this.angle += this.angle_change;
    this.angle_change = 0;
    this.direction = this.get_closest_direction();
    if (this.direction == "up") {
      this.coords[1] -= this.speed;
    } else if (this.direction == "down") {
      this.coords[1] += this.speed;
    } else if (this.direction == "right") {
      this.coords[0] += this.speed;
    } else if (this.direction == "left") {
      this.coords[0] -= this.speed;
    } else if (this.direction == "upleft") {
      this.coords[1] -= (this.speed*Math.sqrt(2))/2;
      this.coords[0] -= (this.speed*Math.sqrt(2))/2;
    } else if (this.direction == "upright") {
      this.coords[1] -= (this.speed*Math.sqrt(2))/2;
      this.coords[0] += (this.speed*Math.sqrt(2))/2;
    } else if (this.direction == "downleft") {
      this.coords[1] += (this.speed*Math.sqrt(2))/2;
      this.coords[0] -= (this.speed*Math.sqrt(2))/2;
    } else if (this.direction == "downright") {
      this.coords[1] += (this.speed*Math.sqrt(2))/2;
      this.coords[0] += (this.speed*Math.sqrt(2))/2;
    }
    this.canvas.context.save();
    //fix rotate so center is center of car
    let center = this.get_center();
    this.canvas.context.translate(center[0], center[1]);
    this.canvas.context.rotate(this.angle*Math.PI/180);
    this.canvas.context.translate(-center[0], -center[1]);
    this.canvas.context.strokeStyle = "black";
    this.canvas.context.strokeRect(this.coords[0], this.coords[1], 20, 30);
    this.canvas.context.fillStyle = this.color;
    this.canvas.context.fillRect(this.coords[0], this.coords[1], 20, 30);
    this.canvas.context.fillStyle = "#b7a8a7";
    this.canvas.context.fillRect(this.coords[0]+1, this.coords[1], 2, 3)
    this.canvas.context.fillRect(this.coords[0]+20-2, this.coords[1], 2, 3)
    this.canvas.context.fillRect(this.coords[0]+1, this.coords[1]+30-10, 18, 7)
    this.canvas.context.restore();
    //debug, center dot
    /*
    this.canvas.context.fillStyle = "black";
    this.canvas.context.fillRect(this.get_center()[0], this.get_center()[1], 3, 3);
    */
  }
}

class Path {
  constructor(canvas, type, coords, direction) {
    //a lane, a turn, or a transfer from one lane to another. should allow the cars to move on it
    this.canvas = canvas;
    //first coord should be start, second be end. in direction cars are going
    this.coords = coords;
    this.type = type;
    this.direction = direction;
    this.connections = []; //connected paths
    this.canvas.components.push(this);
  }
  update() {
    if (this.type == "lane") {
      this.canvas.context.beginPath();
      this.canvas.context.moveTo(...this.coords[0]);
      this.canvas.context.lineTo(...this.coords[1]);
      this.canvas.context.stroke();
    } else if (this.type == "turn") {
      this.canvas.context.beginPath();
      this.canvas.context.moveTo(...this.coords[0]);
      let coords_mod = [...this.coords];
      coords_mod.shift();
      let [a, b] = coords_mod;
      this.canvas.context.quadraticCurveTo(...a, ...b);
      this.canvas.context.stroke();
    }
    this.canvas.context.strokeStyle = "black"
  }
}

//square
class Intersection {
  constructor(canvas, coords) {
    //coords: [[[0,0], [1,1]], [[1,1], [2,2]]] and so on
    this.canvas = canvas;
    this.coords = coords;
    this.canvas.components.push(this);
  }
  update() {
    this.canvas.context.beginPath();
    for (let i=0; i < this.coords.length; i++) {
      this.canvas.context.moveTo(...this.coords[i][0]);
      this.canvas.context.lineTo(...this.coords[i][1]);
    }
    this.canvas.context.stroke();
  }
}

class Text {
  constructor(canvas, text, coords) {
    this.canvas = canvas;
    this.text = text;
    this.coords = coords;
    canvas.components.push(this);
  }
  update() {
    this.canvas.context.fillStyle = "black";
    this.canvas.context.font = "14px Arial";
    this.canvas.context.fillText(this.text, this.coords[0], this.coords[1]); 
  }
}

class Debug {
  constructor(canvas, car) {
    this.canvas = canvas;
    this.car = car;
    canvas.components.push(this);
  }
  update() {
    let coords = [car.coords];
    coords.push([car.coords[0], car.coords[1]+30]);
    coords.push([car.coords[0]+20, car.coords[1]+30]);
    coords.push([car.coords[0]+20, car.coords[1]]);
    /*
    this.canvas.context.fillStyle = 'green';
    this.canvas.context.beginPath();
    this.canvas.context.moveTo(...coords[0]);
    this.canvas.context.lineTo(...coords[1]);
    this.canvas.context.lineTo(...coords[2]);
    this.canvas.context.lineTo(...coords[3]);
    this.canvas.context.closePath();
    this.canvas.context.stroke();
    */
    let actual_coords = [];
    function degrees_to_radians(deg) {
      return deg*Math.PI/180
    }
    for (let i=0; i < coords.length; i++) {
      let center = car.get_center();
      let angle = degrees_to_radians(360-car.angle);
      let offset_coords = [coords[i][0]-center[0], coords[i][1]-center[1]];
      let y = offset_coords[1]*Math.cos(angle)-offset_coords[0]*Math.sin(angle);
      let x = offset_coords[1]*Math.sin(angle)+offset_coords[0]*Math.cos(angle);
      actual_coords.push([center[0]+x,center[1]+y]);
      /*
      let b;
      if (i == 1 || i == 4) {
        b = 135;
      } else {
        b = 225;
      } 
      let l = Car.distance(car.get_center(), coords[i]);
      let delta_x = l*(Math.cos(degrees_to_radians(car.get_center()[1]))-Math.cos(degrees_to_radians(b)));
      let delta_y = l*(Math.sin(degrees_to_radians(car.get_center()[1]))-Math.sin(degrees_to_radians(b)));
      console.log(delta_x, delta_y)
      actual_coords.push([coords[i][0]+delta_x, coords[i][1]+delta_y]);
      */
    }
    this.canvas.context.fillStyle = 'green';
    this.canvas.context.beginPath();
    this.canvas.context.moveTo(...actual_coords[0]);
    this.canvas.context.lineTo(...actual_coords[1]);
    this.canvas.context.lineTo(...actual_coords[2]);
    this.canvas.context.lineTo(...actual_coords[3]);
    this.canvas.context.closePath();
    this.canvas.context.stroke();
  }
}

/*Test script for cars
*/
let canvas = new Canvas([700,700], "game");

let up_light = new Light(canvas, "go", show=true, coords=[90,50]);
let upleft_light = new Light(canvas, "go", show=true, coords=[170,50]);
let upright_light = new Light(canvas, "go", show=true, coords=[250,50]);

let down_light = new Light(canvas, "go", show=true, coords=[90,80]);
let downleft_light = new Light(canvas, "go", show=true, coords=[170,80]);
let downright_light = new Light(canvas, "go", show=true, coords=[250,80]);

let left_light = new Light(canvas, "go", show=true, coords=[90,110]);
let leftdown_light = new Light(canvas, "go", show=true, coords=[170,110]);
let leftup_light = new Light(canvas, "go", show=true, coords=[250,110]);

let right_light = new Light(canvas, "go", show=true, coords=[90,140]);
let rightup_light = new Light(canvas, "go", show=true, coords=[170,140]);
let rightdown_light = new Light(canvas, "go", show=true, coords=[250,140]);

canvas.lights = {'up':up_light, 'upleft':upleft_light, 'upright':upright_light, 'down':down_light, 'downleft':downleft_light, 'downright':downright_light, 'left':left_light, 'leftdown':leftdown_light, 'leftup':leftup_light, 'right':right_light, 'rightup':rightup_light, 'rightdown':rightdown_light};

new Text(canvas, "Up Lane", [5, 50])
new Text(canvas, "Down Lane", [5, 80])
new Text(canvas, "Left Lane", [5, 110])
new Text(canvas, "Right Lane", [5, 140])

new Text(canvas, "Same Lane", [80, 35])
new Text(canvas, "Left Turn", [160, 35])
new Text(canvas, "Right Turn", [240, 35])

canvas.addEvent('click', [up_light, upleft_light, upright_light, down_light, downleft_light, downright_light, left_light, leftdown_light, leftup_light, right_light, rightup_light, rightdown_light]);

function simple_intersection() {
  //one lane every way
  //make square intersection outline
  new Intersection(canvas, [[[200, 200], [500, 200]], [[500, 200], [500, 500]], [[500, 500], [200, 500]], [[200, 500], [200, 200]]])
  return [[new Path(canvas, 'lane', [[320,700],[320,0]], "up"), new Path(canvas, 'lane', [[380,0],[380,700]], "down"), new Path(canvas, 'lane', [[0,320], [700,320]], "right"), new Path(canvas, 'lane', [[700,380], [0,380]], "left")], [new Path(canvas, 'turn', [[320,500], [350, 350], [200,380]], "upleft"), new Path(canvas, 'turn', [[320,500], [350, 350], [500,320]], "upright"), new Path(canvas, 'turn', [[380,200], [350, 350], [500,320]], "downright"), new Path(canvas, 'turn', [[380,200], [350, 350], [200,380]], "downleft"), new Path(canvas, 'turn', [[500, 380], [350, 350], [320, 200]], "upleft"), new Path(canvas, 'turn', [[500, 380], [350, 350], [380, 500]], "downleft"), new Path(canvas, 'turn', [[200, 320], [350, 350], [320, 200]], "upright"), new Path(canvas, 'turn', [[200, 320], [350, 350], [380,500]], "downright")]]
}

function spawn_car(lane, goal) {
  let coords = JSON.parse(JSON.stringify(lane.coords[0]));
  let spawn_coords = coords;
  if (lane.direction == "up" || lane.direction == "down") {
    spawn_coords[0] = spawn_coords[0]-10;
  } else if (lane.direction == "left" || lane.direction == "right") {
    spawn_coords[1] = spawn_coords[1]-10;
  }
  let car = new Car(canvas, lane.direction, show=true);
  car.coords = spawn_coords;
  car.path = lane;
  car.goal = goal;
  return car
}

let [lanes, turns] = simple_intersection();

//[new Path(canvas, 'lane', [[320,700],[320,0]], "up"), new Path(canvas, 'lane', [[380,0],[380,700]], "down"), new Path(canvas, 'lane', [[0,320], [700,320]], "right"), new Path(canvas, 'lane', [[700,380], [0,380]], "left")]
//["upleft", "upright", "downright", "downleft", "upleft", "downleft", "upright", "downright"]
lanes[0].connections.push(turns[0]);
lanes[0].connections.push(turns[1]);

turns[0].connections.push(lanes[3]);
turns[1].connections.push(lanes[2]);

lanes[1].connections.push(turns[2])
lanes[1].connections.push(turns[3])

turns[2].connections.push(lanes[2]);
turns[3].connections.push(lanes[3]);

lanes[2].connections.push(turns[6]);
lanes[2].connections.push(turns[7]);

turns[6].connections.push(lanes[0]);
turns[7].connections.push(lanes[1]);

lanes[3].connections.push(turns[4]);
lanes[3].connections.push(turns[5]);

turns[4].connections.push(lanes[0]);
turns[5].connections.push(lanes[1]);

//downright debug

//lanes[1].connections.push(turns[]);

//randomly spawn cars
let cars = [];

//right

//cars = [spawn_car(lanes[0], lanes[2]), spawn_car(lanes[0], lanes[3])]

//cars = [spawn_car(lanes[1], lanes[2]), spawn_car(lanes[1], lanes[3])]

//cars = [spawn_car(lanes[2], lanes[0]), spawn_car(lanes[2], lanes[1])]

/*
left_light.state = "stop";

cars.push(spawn_car(lanes[3], lanes[3]));
let interval = setInterval(function() {
  cars.push(spawn_car(lanes[3], lanes[1]));
}, 400);

setTimeout(function() {
  clearInterval(interval)
}, 800)
*/

/*
for (let i=0; i < 9; i++) {
  //random lanes
  //BUG: For example, if up lane is going to down lane, that is impossible. prevent that from happening
  let start = Math.floor(Math.random()*lanes.length);
  let destination = Math.floor(Math.random()*lanes.length);
  if (!((start == 0 && destination == 1) || start == 1 && destination == 0) || (start == 2 && destination == 3) || (start == 3 && destination == 2)) {
    let car = spawn_car(lanes[start], lanes[destination]);
    cars.push(car);
  }
}
*/

canvas.crash_counter = 0;

function car_spawn_func() {
  let start = Math.floor(Math.random()*lanes.length);
  let destination = Math.floor(Math.random()*lanes.length);
  if (!((start == 0 && destination == 1) || start == 1 && destination == 0) || (start == 2 && destination == 3) || (start == 3 && destination == 2)) {
    let car = spawn_car(lanes[start], lanes[destination]);
    cars.push(car);
    document.getElementById('t-car-num').innerText = String(cars.length);
    let current_cars = canvas.components.filter(function(i) {return i.constructor.name == "Car" && i.show && !Car.true_off_canvas(i.coords, canvas) });
    document.getElementById('c-car-num').innerText = String(current_cars.length);
    document.getElementById('crashes-num').innerText = String(canvas.crash_counter);
    document.getElementById('cc-ratio').innerText = String((canvas.crash_counter/cars.length).toPrecision(4))
  }
}

let car_spawn_interval = setInterval(car_spawn_func, 400);

/*
let start = Math.floor(Math.random()*lanes.length);
let destination = Math.floor(Math.random()*lanes.length);
//let car = spawn_car(lanes[start], lanes[destination]);
let car = spawn_car(lanes[0], lanes[0]);
cars.push(car);
*/

/*
up_light.state = "stop";

cars.push(spawn_car(lanes[0], lanes[0]));
setTimeout(function() {
  cars.push(spawn_car(lanes[0], lanes[0]));
}, 400);
*/

//new Debug(canvas, cars[0])

setInterval(function() {
  canvas.update();
}, 1000/24);

canvas.canvas.addEventListener('mousedown', function(e) {
  let rect = canvas.canvas.getBoundingClientRect();
  document.getElementById('debug-info').innerText = "["+(e.clientX-rect.left)+", "+(e.clientY-rect.top)+"]";
  //check if point is in car
  //console.log(Car.point_in_rect([e.clientX-rect.left, e.clientY-rect.top], [cars[0].coords, cars[0].angle, cars[0].get_center()]));
  /**/
})

document.getElementById('debug-stop-cars').addEventListener('click', function() {
  for (let i=0; i < cars.length; i++) {
    cars[i].goal = undefined;
    cars[i].speed = 0;
    cars[i].forward = false;
    cars[i].turning = false;
  }
  clearInterval(car_spawn_interval);
})

document.getElementById('toggle-show-crash').addEventListener('click',function() {
  canvas.show_crash = !canvas.show_crash;
})

document.getElementById('toggle-crash-vanish').addEventListener('click',function() {
  canvas.crash_vanish = !canvas.crash_vanish;
})

document.getElementById('apply-function').addEventListener('click',function() {
  canvas.light_handler = function(lights, cars) {
    document.getElementById('custom-function').value;
  }
})

document.getElementById('spawnRate').addEventListener('change', function() {
  clearInterval(car_spawn_interval);
  car_spawn_interval = setInterval(car_spawn_func, document.getElementById('spawnRate').value);
});

/*
`
if (this.in_progress_) {
  return
}
for (light_num=0; light_num < lights.length; light_num++) {
  //alternate the lights
  lights[light_num]
  //green: up lane all, down lane all, left lane all, right lane all, repeat
  if (!this.current_direction_) {
    this.current_direction_ = 'up';
    this.in_progress_ = false;
  }
  //
}
`
*/

/*
document.addEventListener("keydown", function(event) {
  switch (event.keyCode) {
    case 37:
      car.turnLeft();
      break;
    case 38:
      car.accelerate();
      break;
    case 39:
      car.turnRight();
      break;
    case 40:
      car.decelerate();
      break;
  }
});
*/