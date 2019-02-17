
const ImportHelper = require('./js/importhelper.js');
const Pdf2JSON = require('pdf2json');

if (process.argv.length < 4) {
	console.log("Usage : node casparser.js file password [-csv] [-gain]\n");
}
else {
	var filepath;
	var pass;
	var formatCsv = false;
	var gainStatement = false;

  	for (argIdx in process.argv) {
  		var arg = process.argv[argIdx];

  		// Skup first 2 arguments
  		if (argIdx == "0" || argIdx == "1") continue;
  		if (!arg.startsWith('-')) {
  			if (filepath == undefined) {
  				filepath = arg;
  			}
  			else if (pass == undefined) {
  				pass = arg;
  			}
  			else {
  				console.log("Unknown argument : " + arg);
				console.log("Usage : node casparser.js file password [-csv] [-gain]\n");
  			}
  		}
  		else if (arg == "-csv") {
  			formatCsv = true;
  		}
  		else if (arg == "-gain") {
  			gainStatement = true;
  		}
  		else {
			console.log("Unknown argument : " + arg);
			console.log("Usage : node casparser.js file password [-csv] [-gain]\n");
  		}
  	}

	ImportHelper.LoadPdf(filepath, pass, (pdf) => {
		if (pdf.Success) {
			console.log("Parse Success : Data for " + pdf.Output.length + " funds found.");

			// filename is a string that contains the path and filename created in the save file dialog.
      		var fs = require('fs');
      		var outFile;
      		var outData;

      		if (formatCsv) {
      			outFile = filepath + ".csv";
	      		if (fs.existsSync(outFile) == false) {
      				outData = ImportHelper.ConvertToCSV(pdf.Output, gainStatement);
	      		}
      		}
      		else {
      			outFile = filepath + ".json";
	      		if (fs.existsSync(outFile) == false) {
      				outData = JSON.stringify(pdf.Output);
      			}
      		}

      		if (outData == undefined) {
      			console.log("Write Failed : File " + outFile + " already exists.");
      		}
      		else {
	      		fs.writeFile(outFile, outData, (err) => {
	        		if (err){
	          			console.log("An error ocurred creating the file "+ err.message)
	        		}
	        		else {
	          			console.log("The file has been succesfully saved");
	        		}
	      		});
      		}
		}
		else {
			console.log("Failed : " + pdf.Reason);
		}
	});
}