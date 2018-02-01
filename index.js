// Homebridge plugin to reading BMP180 Sensor on a Raspberry PI.

// Uses pigpio library to access gpio pin, and a custom program dht22 read the sensor.

//"accessories": [{
//    "accessory": "BMP180",
//    "name": "Temp/Pressure",
//    "service": "bmp180"
//}]


var Service, Characteristic, FakeGatoHistoryService;
var exec = require('child_process').execFile;
var cputemp, dhtExec;
var debug = require('debug')('BMP180');
var logger = require("mcuiot-logger").logger;
const moment = require('moment');
var os = require("os");
var hostname = os.hostname();

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  FakeGatoHistoryService = require('fakegato-history')(homebridge);
  homebridge.registerAccessory("homebridge-bmp180", "BMP180", BMP180Accessory);
}


function BMP180Accessory(log, config) {
  this.log = log;
  this.log("Adding Accessory");
  this.config = config;
  this.name = config.name;
  this.name_temperature = config.name_temperature || config.name;
  this.name_pressure = config.name_pressure || config.name;
  this.service = config.service || "bmp180";
  this.refresh = config.refresh || "60"; // Every minute

  bmp180Exec = config.bmp180Exec || "bmp180";

  this.log_event_counter = 59;
  this.spreadsheetId = config['spreadsheetId'];
  if (this.spreadsheetId) {
    this.logger = new logger(this.spreadsheetId);
  }


}

BMP180Accessory.prototype = {

  getBMP180TemperaturePressure: function(callback) {
    exec(bmp180Exec, function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('bmp180Exec function failed: ' + error);
        callback(error);
      } else {
        // bmp180 output format - gives a 3 in the first column when it has troubles
        // 0 24.8 C 768 mmHg 
        var result = responseBody.toString().split(/[ \t]+/);
        var temperature = parseFloat(result[1]);
        var pressure = parseFloat(result[3]);

        //                this.pressure = pressure;
        this.log("BMP180 Status: %s, Temperature: %s, Pressure: %s", result[0], temperature, pressure);


        this.log_event_counter = this.log_event_counter + 1;
        if (this.log_event_counter > 59) {
          if (this.spreadsheetId) {
            this.logger.storeBMP180(this.name, result[0], temperature, pressure);
          }
          this.log_event_counter = 0;
        }

        var err;
        if (parseInt(result[0]) !== 0) {
          this.log.error("Error: bmp180 read failed with status %s", result[0]);
          err = new Error("bmp180 read failed");
          pressure = err;
        } else {

            this.loggingService.addEntry({
              time: moment().unix(),
              temp: temperature,
              pressure: pressure
            });

        }
        this.pressureService
          .getCharacteristic(Characteristic.CurrentRelativepressure).updateValue(pressure);
        callback(err, temperature);
      }
    }.bind(this));
  },

  identify: function(callback) {
    this.log("Identify requested!");
    callback(); // success
  },

  getServices: function() {

    this.log("INIT: %s", this.name);

    // you can OPTIONALLY create an information service if you wish to override
    // the default values for things like serial number, model, etc.
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "ADalichuk")
      .setCharacteristic(Characteristic.Model, this.service)
      .setCharacteristic(Characteristic.SerialNumber, hostname+"-"+this.name)
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

    switch (this.service) {

      case "bmp180":
        this.BMP180Service = new Service.TemperatureSensor(this.name_temperature);
        this.BMP180Service
          .getCharacteristic(Characteristic.CurrentTemperature)
          .setProps({
            minValue: -100,
            maxValue: 100
          });
        //                  .on('get', this.getBMP180TemperaturePressure.bind(this));

        this.pressureService = new Service.pressureSensor(this.name_pressure);

        this.BMP180Service.log = this.log;
        this.loggingService = new FakeGatoHistoryService("weather", this.BMP180Service,4032,this.refresh * 10/60);

        setInterval(function() {
          this.getBMP180TemperaturePressure(function(err, temp) {
            if (err)
              temp = err;
            this.BMP180Service
              .getCharacteristic(Characteristic.CurrentTemperature).updateValue(temp);
          }.bind(this));

        }.bind(this), this.refresh * 1000);

        this.getBMP180TemperaturePressure(function(err, temp) {
          this.BMP180Service
            .setCharacteristic(Characteristic.CurrentTemperature, temp);
        }.bind(this));
        return [this.BMP180Service, informationService, this.pressureService, this.loggingService];

    }
  }
};
