/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "CoverageCollector",
]

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const {TextEncoder, OS} = Cu.import("resource://gre/modules/osfile.jsm", {});
const {addDebuggerToGlobal} = Cu.import("resource://gre/modules/jsdebugger.jsm",
                                        {});
addDebuggerToGlobal(this);

/**
 * Records coverage for each test by way of the js debugger.
 */
this.CoverageCollector = function (prefix) {
  this._prefix = prefix;
  this._dbg = new Debugger();
  this._dbg.collectCoverageInfo = true;
  this._dbg.addAllGlobalsAsDebuggees();
  this._scripts = this._dbg.findScripts();

  this._dbg.onNewScript = (script) => {
    this._scripts.push(script);
  };

  // Source -> coverage data;
  this._allCoverage = {};
  this._encoder = new TextEncoder();
  this._testIndex = 0;
}

CoverageCollector.prototype._getLinesCovered = function () {
  let coveredLines = {};
  let methodNames = {};
  let currentCoverage = {};
  let temp = 0;
  this._scripts.forEach(s => {
    let scriptName = s.url;
    let cov = s.getOffsetsCoverage();
     
    if (!cov) {
      return;
    }  
    cov.forEach(covered => {
      let {lineNumber, columnNumber, offset, count} = covered;
      if (!count) {
        return;
      }
      
      if (!currentCoverage[scriptName]) {
        currentCoverage[scriptName] = {};
      }
      
      if (!this._allCoverage[scriptName]) {
        this._allCoverage[scriptName] = {};
      }
      
      let key = [lineNumber, columnNumber, offset].join('#');
      if (!currentCoverage[scriptName][key]) {
        currentCoverage[scriptName][key] = count;
      } else {
        currentCoverage[scriptName][key] += count;
      }
      
    });  
  });

  // Covered lines are determined by comparing every offset mentioned as of the
  // the completion of a test to the last time we measured coverage. If an
  // offset in a line is novel as of this test, or a count has increased for
  // any offset on a particular line, that line must have been covered.
  for (let scriptName in currentCoverage) {
    for (let key in currentCoverage[scriptName]) {
      if (!this._allCoverage[scriptName] ||
          !this._allCoverage[scriptName][key] ||
          (this._allCoverage[scriptName][key] <
           currentCoverage[scriptName][key])) {
        let [lineNumber, colNumber, offset] = key.split('#');
        if (!coveredLines[scriptName]) {
          coveredLines[scriptName] = new Set();
        }
        coveredLines[scriptName].add(parseInt(lineNumber, 10));
        this._allCoverage[scriptName][key] = currentCoverage[scriptName][key];
      }
    }
  }

  return coveredLines;
}


CoverageCollector.prototype._recordMethods = function() {
    let methodNames = {};
    let temp = 0;
    this._scripts.forEach(s=> {
        let method = s.displayName;
        let scriptName = s.url;
        let cov = s.getOffsetsCoverage();
        if (!cov) {
            return;
        }
        if(!method){
            return;
        }
        
        if(!methodNames[scriptName]){
            methodNames[scriptName] = new Set();
        }
        
        cov.forEach(covered => {
            
              let {lineNumber, columnNumber, offset, count} = covered;
              if (!count) {
                return;
              }

              if (!this._allCoverage[scriptName]) {
                this._allCoverage[scriptName] = {};
              }

              let key = [lineNumber, s.displayName].join('#');
              if (!methodNames[scriptName][key]) {
                methodNames[scriptName][key] = key;
              }
        });
        
    });
    
    return methodNames;
}


/**
 * Records lines covered since the last time coverage was recorded,
 * associating them with the given test name. The result is written
 * to a json file in a specified directory.
 */
CoverageCollector.prototype.recordTestCoverage = function (testName) {
  dump("Collecting coverage for: " + testName + "\n");
  let rawLines = this._getLinesCovered(testName);
  let result = [];
  let methods = this._recordMethods(testName);
  for (let scriptName in rawLines) {
    let rec = {
      testUrl: testName,
      sourceFile: scriptName,
      method: [],
      covered: []
    };
    
    let finalRec = {
        methodName: "null",
        cov: []
    }
    let covering = [];
    let methodTest = null;
    for (let methodKey in methods[scriptName]){
        let [lineNumber, methodJoin] = methodKey.split("#");
        if(!methodTest){
            methodTest = methodJoin;
        }
        else if(methodTest !== methodJoin){
            let methodRec = { methodName: methodTest, cov: covering };
            rec.method.push(methodRec);
            covering = [];
            methodTest = methodJoin;
        }
        covering.push(parseInt(lineNumber, 10));
        finalRec.cov = covering;
        finalRec.methodName = methodJoin;
    }
    if(finalRec.methodName != "null"){
        rec.method.push(finalRec);
    }
      
    for (let line of rawLines[scriptName]) {
        rec.covered.push(line);
    }
    result.push(rec);
  }
  let arr = this._encoder.encode(JSON.stringify(result, null, 2));
  let path = this._prefix + '/' + 'jscov_' + Date.now() + '.json';
  dump("Writing coverage to: " + path + "\n");
  return OS.File.writeAtomic(path, arr, {tmpPath: path + '.tmp'});
}

/**
 * Tear down the debugger after all tests are complete.
 */
CoverageCollector.prototype.finalize = function () {
  this._dbg.removeAllDebuggees();
  this._dbg.enabled = false;
}
