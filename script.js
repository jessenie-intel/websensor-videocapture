/*
 * Websensor video stabilization project
 * https://github.com/jessenie-intel/websensor-video
 *
 * Copyright (c) 2017 Jesse Nieminen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

'use strict';

var constraints = {audio: true,video: {  width: { min: 640, ideal: 640, max: 640 },  height: { min: 480, ideal: 480, max: 480 }}};
var mediaRecorder = null;
var chunks = [];
var videoData = null;
var interval = null;

var accel_sensor = null;
var orientation_sensor = null;
var gyroscope = null;
var sensorfreq = 30;
var selectedSensor = null;

//var roll = null;
//var pitch = null;
//var yaw = null;
var accel = {"x": null, "y": null, "z": null};
var accel_last = {"x": null, "y": null, "z": null};
var accelNoG = {"x": null, "y": null, "z": null};
var accel_filtered = null;
var aVel = {"x": null, "y": null, "z": null};
var ori = {"roll": null, "pitch": null, "yaw": null, "time": null};
var oriInitial = {"roll": null, "pitch": null, "yaw": null, "time": null};
var initialoriobtained = false;
var orientationData = [];       //array to store all the orientation data
var aVelData = [];
var frameData = {"data": null, "time": null, "ori": null, "aVel": null, "accel": null, "accelnog": null};
var dataArray = [];     //array to store all the combined data
var dataArray2 = [];     //array to store all the combined data

var velocity = {"x": 0, "y": 0, "z": 0};

var time = null;
var timestamps = [];
var timeAtStart = null;
var nFrame = 0; //frame number with which we can combine timestamp and frame data
var prevFrame = null;      //previous frame

//canvas
var canvas = document.querySelector('canvas');
//var canvas = document.createElement('canvas');
//CSS.elementSources.set("pfcanvas", canvas);
var ctx = canvas.getContext('2d');
//var ctx = document.getCSSCanvasContext("2d", "name_of_canvas", 100, 100); - polyfill from https://css-tricks.com/media-fragments-uri-spatial-dimension/

//video element
var videoElement = document.querySelector('video');
videoElement.controls = false;
var videoURLBase = null;

var ref = null;
var extraFrames = 0;
var x = 0;
var y = 0;      //position for the square

class HighPassFilterData {      //https://w3c.github.io/motion-sensors/#pass-filters
  constructor(reading, cutoffFrequency) {
    Object.assign(this, { x: reading.x, y: reading.y, z: reading.z });
    this.cutoff = cutoffFrequency;
    this.timestamp = reading.timestamp;
  }

  update(reading) {
    let dt = reading.timestamp - this.timestamp / 1000;
    this.timestamp = reading.timestamp;

    for (let i of ["x", "y", "z"]) {
      let alpha = this.cutoff / (this.cutoff + dt);
      this[i] = this[i] + alpha * (reading[i] - this[i]);
    }
  }
};


class LowPassFilterData {       //https://w3c.github.io/motion-sensors/#pass-filters
  constructor(reading, bias) {
    Object.assign(this, { x: reading.x, y: reading.y, z: reading.z });
    this.bias = bias;
  }
        update(reading) {
                this.x = this.x * this.bias + reading.x * (1 - this.bias);
                this.y = this.y * this.bias + reading.y * (1 - this.bias);
                this.z = this.z * this.bias + reading.z * (1 - this.bias);
        }
};

class KalmanFilter {
  constructor() {
    this.Q_angle = 0.01;
    this.Q_gyro = 0.0003;
    this.R_angle = 0.01;

    this.reset();
  }

  reset() {
    this.angle = 0.0;
    this.bias = 0;

    this.P00 = 0;
    this.P01 = 0;
    this.P10 = 0;
    this.P11 = 0;
  }

  filter(accAngle, gyroRate, dt) {
    this.angle += dt * (gyroRate - this.bias);

    this.P00 += -dt * (this.P10 + this.P01) + this.Q_angle * dt;
    this.P01 += -dt * this.P11;
    this.P10 += -dt * this.P11;
    this.P11 += + this.Q_gyro * dt;

    let axis = accAngle - this.angle;
    let S = this.P00 + this.R_angle;
    let K0 = this.P00 / S;
    let K1 = this.P10 / S;

    this.angle += K0 * axis;
    this.bias  += K1 * axis;

    this.P00 -= K0 * this.P00;
    this.P01 -= K0 * this.P01;
    this.P10 -= K1 * this.P00;
    this.P11 -= K1 * this.P01;

    return this.angle;
  }
};

class OriSensor {
        constructor() {
        const sensor = new RelativeOrientationSensor({ frequency: sensorfreq });
        const mat4 = new Float32Array(16);
        const euler = new Float32Array(3);
        sensor.onreading = () => {
                sensor.populateMatrix(mat4);
                toEulerianAngle(sensor.quaternion, euler);      //From quaternion to Eulerian angles
                this.roll = euler[0];
                this.pitch = euler[1];
                this.yaw = euler[2];
                this.timestamp = sensor.timestamp;
                if (this.onreading) this.onreading();
        };
        sensor.onactivate = () => {
                if (this.onactivate) this.onactivate();
        };
        const start = () => sensor.start();
        Object.assign(this, { start });
        }
}

function magnitude(vector)      //Calculate the magnitude of a vector
{
return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

function update_debug()
{
                        document.getElementById("ori").textContent = `Orientation: ${ori.roll} ${ori.pitch} ${ori.yaw}`;
                        document.getElementById("accel").textContent = `Acceleration: ${accel.x} ${accel.y} ${accel.z}, M ${magnitude(accel).toFixed(3)}`;
                        document.getElementById("accelnog").textContent = `Linear acceleration (no gravity): ${accelNoG.x} ${accelNoG.y} ${accelNoG.z}, M ${magnitude(accelNoG).toFixed(3)}`;
                        document.getElementById("rrate").textContent = `Rotation rate: ${aVel.x} ${aVel.y} ${aVel.z}, M ${magnitude(aVel).toFixed(3)}`;
                        document.getElementById("selectedSensor").textContent = `${selectedSensor}`;
}

function selectSensor() {
        selectedSensor = document.getElementById("selectSensor").value;
        console.log(selectedSensor, "selected");
}

//WINDOWS 10 HAS DIFFERENT CONVENTION: Yaw z, pitch x, roll y
function toEulerianAngle(quat, out)
{
        const ysqr = quat[1] ** 2;

        // Roll (x-axis rotation).
        const t0 = 2 * (quat[3] * quat[0] + quat[1] * quat[2]);
        const t1 = 1 - 2 * (ysqr + quat[0] ** 2);
        out[0] = Math.atan2(t0, t1);
        // Pitch (y-axis rotation).
        let t2 = 2 * (quat[3] * quat[1] - quat[2] * quat[0]);
        t2 = t2 > 1 ? 1 : t2;
        t2 = t2 < -1 ? -1 : t2;
        out[1] = Math.asin(t2);
        // Yaw (z-axis rotation).
        const t3 = 2 * (quat[3] * quat[2] + quat[0] * quat[1]);
        const t4 = 1 - 2 * (ysqr + quat[2] ** 2);
        out[2] = Math.atan2(t3, t4);
        return out;
}

function errorCallback(error){
	console.log("error: ", error);	
}

function startDemo () {
		navigator.getUserMedia(constraints, startRecording, errorCallback);
}

function startRecording(stream) {

                try {
                //Initialize sensors
                accel_sensor = new LinearAccelerationSensor({frequency: sensorfreq});
                // Remove drift with a high pass filter.
                //const accel_filtered =  new HighPassFilterData(accel_sensor, 0.8);
                accel_sensor.onreading = () => {
                        accel = {"x": accel_sensor.x, "y": accel_sensor.y, "z": accel_sensor.z};
                        //accel = {"x": (1/2)*(accel_last.x + accel_sensor.x), "y": (1/2)*(accel_last.y + accel_sensor.y), "z": (1/2)*(accel_last.z + accel_sensor.z)};
                        //accel_last = accel;     //for smoothing the data
                        //accel_filtered.update(accel_sensor);                   
                        //accel = accel_filtered;                        
                        //accelNoG = {x:accel.x - gravity.x, y:accel.y - gravity.y, z:accel.z - gravity.z};
                };
                accel_sensor.onactivate = () => {
                };
                accel_sensor.start();
                gyroscope = new Gyroscope({frequency: sensorfreq});
                //const gyro_data = new HighPassFilterData(gyroscope, 0.8);
                gyroscope.onreading = () => {
                        //gyro_data.update(gyroscope);
                        //aVel = {x:gyro_data.x, y:gyro_data.y, z:gyro_data.z};
                        aVel = {x:gyroscope.x, y:gyroscope.y, z:gyroscope.z};
                };
                gyroscope.onactivate = () => {
                };
                gyroscope.start();
                orientation_sensor = new OriSensor({frequency: sensorfreq});
                orientation_sensor.onreading = () => {
                        let roll = orientation_sensor.roll;
                        let pitch = orientation_sensor.pitch;
                        let yaw = orientation_sensor.yaw;
                        time = orientation_sensor.timestamp;
                        if(!initialoriobtained) //obtain initial orientation
                        {
                                oriInitial = {"roll": orientation_sensor.roll, "pitch": orientation_sensor.pitch, "yaw": orientation_sensor.yaw, "time": orientation_sensor.timestamp};
                                timeAtStart = orientation_sensor.timestamp;
                                initialoriobtained = true;
                        }
                        ori = {"roll": orientation_sensor.roll, "pitch": orientation_sensor.pitch, "yaw": orientation_sensor.yaw, "time": orientation_sensor.timestamp};
                };
                orientation_sensor.onactivate = () => {
                };
                orientation_sensor.start();
                }
                catch(err) {
                        console.log(err.message);
                        console.log("Your browser doesn't seem to support generic sensors. If you are running Chrome, please enable it in about:flags.");
                        //this.innerHTML = "Your browser doesn't seem to support generic sensors. If you are running Chrome, please enable it in about:flags";
                }
                        interval=window.setInterval(update_debug,100);
	        //var options = {mimeType: 'video/webm;codecs=vp9'};
		//mediaRecorder = new MediaRecorder(stream, options);
		mediaRecorder = new MediaRecorder(stream);

	        mediaRecorder.start(10);

	        var url = window.URL;
	        videoElement.src = url ? url.createObjectURL(stream) : stream;	        
                //videoElement.play();

	        mediaRecorder.ondataavailable = function(e) {
                        //console.log("Data available", e);
                        //console.log(time);
                        timestamps.push(time);
                        frameData.time = time;
		        chunks.push(e.data);
                        frameData.data = e.data;         
                        orientationData.push(ori);
                        aVelData.push(aVel);
                        frameData.ori = ori;
                        frameData.aVel = aVel;
                        frameData.accel = accel;
                        //frameData.accelnog = accelNoG;
                        //dataArray.push(frameData);
                        var b = new Object;     //need to push by value
                        Object.assign(b, frameData);
                        dataArray.push(b);
                        frameData = {"data": null, "time": null, "ori": null, "aVel": null, "accel": null, "accelnog": null};
	        };

	        mediaRecorder.onerror = function(e){
		        console.log('Error: ', e);
	        };


	        mediaRecorder.onstart = function(){
                        console.log("Recording started", mediaRecorder.state);
	        };

	        mediaRecorder.onstop = function(){
		        var blob = new Blob(chunks, {type: "video/webm"});
		        chunks = [];

		        videoURLBase = window.URL.createObjectURL(blob);

		        videoElement.src = videoURLBase + "#xywh=pixel:0,0,320,240";
                        videoElement.load();
                        
                        //resize canvas
videoElement.addEventListener('loadedmetadata', function() {
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
});
videoElement.addEventListener('play', function() { 
        videoElement.play();
        nFrame = 0;
        readFrameData(blob, orientationData);    //reads the video into dataArray2
}, false);

                        /*//Read blob data so we can stabilize the video                        
                        var reader = new FileReader();
                         reader.onload = function(event){
                                let text = reader.result;
                                console.log(text);
                          };
                        reader.readAsText(blob, "video/webm");*/
                        //console.log(orientationData);
                        //console.log(timestamps);
                        //console.log(dataArray);
/*
var blobUrl = URL.createObjectURL(blob);
var x = new XMLHttpRequest();
// set x.responseType = 'blob' if you want to get a Blob object:
// x.responseType = 'blob';
x.onload = function() {
    alert(x.responseText);
};
console.log(x.open('get', blobUrl));*/
                        readFrameData(blob, orientationData);    //reads the video into dataArray2
                        //console.log(dataArray);
                        /*videoElement.onended = function() {
                                alert("The video has ended");
                                cancelAnimationFrame(ref);
                        };*/
                        //ctx.clearRect(0, 0, canvas.width, canvas.height);
                        //stabilize(dataArray2);        //now we can operate on it
	        };

	        mediaRecorder.onpause = function(){
	        }

	        mediaRecorder.onresume = function(){
	        }

	        mediaRecorder.onwarning = function(e){
	        };
}

function stopRecording(){
	mediaRecorder.stop();
        //Now stabilize
	videoElement.controls = true;
}
//Idea: copy video to canvas, operate on the video, and then use the canvas with the stabilized video as source for the video element
function readFrameData(blob, oriArray) {     //Read video data from blob to object form with pixel data we can operate on
        //console.log("frame");
        nFrame = videoElement.webkitDecodedFrameCount - extraFrames;
        //console.log(prevFrame, nFrame);
        //let x = 0;
        //let y = 0;
        //Modifying canvas size, we can show only the desired part of the video TODO: modify according to stabilization box
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        let dx = 0;
        let dy = 0;
        var timeFromStart = null;
        let frameDataL = dataArray[nFrame];
        if(nFrame === 0)
        {
                console.log(dataArray);
                //timeAtStart = frameDataL.ori.time;
        }
        else if(nFrame !== 0 && nFrame !== prevFrame && frameDataL !== undefined)    //all subsequent frames
        {
                console.log(nFrame);
                //console.log(dataL);
                timeFromStart = frameDataL.time - timeAtStart; //time since recording start (in ms)
                console.log(timeFromStart);
                //console.log(frameDataL);
                //console.log(nFrame);
                //console.log(videoElement.webkitDecodedFrameCount);      //only works in webkit browsers
                //console.log(timestamps[nFrame] - timestamps[0], videoElement.currentTime);
                //while(!videoElement.ended)
                //{
                let oriDiff = null;
                let deltaT = frameDataL.time - dataArray[nFrame-1].time;
                //console.log(deltaT);
                let acceleration_filtered = null;
                //if(magnitude(frameDataL.accel) > 0.5)    //filter out small values in acceleration (noise)
                //{
                        acceleration_filtered = frameDataL.accel;
                /*}
                else
                {
                        acceleration_filtered = {"x":0, "y":0, "z": 0};
                }*/
                velocity = {"x": velocity.x + acceleration_filtered.x * deltaT/1000, "y": velocity.y + acceleration_filtered.y * deltaT/1000, "z": velocity.z + acceleration_filtered.z * deltaT/1000};    //velocity per second TODO: add friction
                //console.log(velocity);
                /*if(dataL === undefined)
                {
                        var dataL = new Object;     //need to push by value
                        Object.assign(dataL, dataArray);
                }*/
                //console.log(dataL);
                        //videoElement.playbackRate = 0.5;        //fix playback being too fast
                        let ori = orientationData[nFrame];
                        //ori = dataArrayL[nFrame].ori;
                        let aVel = frameDataL.aVel;
                        //console.log(nFrame, ori, aVel);
                        oriDiff = {"roll": ori.roll-oriInitial.roll, "pitch": ori.pitch-oriInitial.pitch, "yaw": ori.yaw-oriInitial.yaw};
                        //accelerometer not taken into account atm
                                //dx = -(videoElement.videoWidth*(aVel.y/(2)) + 0*videoElement.videoWidth*velocity.x)*deltaT/1000;
                                //dy = (-videoElement.videoHeight*(aVel.x/(2)) + 0*videoElement.videoHeight*velocity.y)*deltaT/1000;
                                //x = x + dx;
                                //y = y + dy;
                                //x = 100*oriDiff.yaw;
                                //y = 100*oriDiff.roll;
                                x = videoElement.videoWidth*(oriDiff.yaw/2*(Math.PI));
                                y = -videoElement.videoHeight*(oriDiff.roll/2*(Math.PI));     //each 2pi means 1 video height
                        //videoElement.currentTime = ((nFrame/dataArray.length)*videoElement.duration).toFixed(3);
                        //}          
                        //console.log(x, y);

                        //ctx.drawImage(videoElement, 0, 0);
                        //let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        /*let pixeldataArray = [];
                        //loop through every pixel
                        for(let i=0; i<imageData.data.length; i = i+4)
                        {
                                let pixeldata = {"red": imageData.data[i], "green":imageData.data[i+1], "blue": imageData.data[i+2], "alpha":imageData.data[i+3]};
                                //pixeldataArray.push(pixeldata);
                        }
                        //pixeldataArray.push(imageData);*/
                        //if(ori !== undefined) {
                                //let timestamp = dataArray[nFrame].time;
                                //let frameData2 = {"imagedata": imageData, "time": timestamp, "oridiff": oriDiff};
                                //dataArray2.push(frameData2);
                                //console.log(pixeldataArray);
                                //newImageData.data = data;
                            // Draw the pixels onto the visible canvas
                            //ctx.putImageData(newImageData,0,0);
                                //ctx.putImageData(imageData, 0, 0)
                                //xD
                        //}
                //} 
                /*
                if(dataArray2.length === timestamps.length)     //now we have read the whole blob - should use callback here instead of if condition
                {
                        console.log("ended");
                        cancelAnimationFrame(ref);
                        console.log(dataArray2);
                        stabilize(dataArray2);
                } */ 
        }
        //render video and rect
        let widthR = 0.8*canvas.width;
        let heightR = 0.8*canvas.height;
        let videoURL = videoURLBase + "#xywh=pixel:0,0,320,240";
        //videoElement.currentTime = timeFromStart/1000;        //TODO: fix currentTime
        //videoElement.currentTime = (nFrame/dataArray.length)*videoElement.duration;
        //videoElement.currentTime = parseFloat(videoElement.duration * Math.random().toFixed(3));
        //videoElement.src = videoURL;
        //videoElement.load();
        //videoElement.play();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(videoElement,0,0, videoElement.videoWidth, videoElement.videoHeight);
        ctx.beginPath();
        ctx.rect(x+0.1*canvas.width,y+0.1*canvas.height,widthR,heightR);
        ctx.stroke();
        if(videoElement.ended)
        {
                x = 0;
                y = 0;
                console.log("ended");
                cancelAnimationFrame(ref);
        }
        if(nFrame >= orientationData.length-1)
        {
                x = 0;
                y = 0;
                extraFrames = extraFrames + nFrame;
                prevFrame = null;
                nFrame = 0;
                cancelAnimationFrame(ref);
        }
        prevFrame = nFrame;
        ref = requestAnimationFrame(readFrameData);
}

function stabilize(dataArrayArg) { //Create a stabilized video from the pixel data given as input
        let frame = dataArrayArg[0];      //first frame
        console.log(frame);
        //ctx.drawImage(frame.imagedata,0,0, videoElement.videoWidth, videoElement.videoHeight);
        //ctx.putImageData(frame.imagedata, 0, 0);
}
