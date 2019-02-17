exports.Verbose = false;

function ParseCurrency(currency_str) {
  return parseFloat(currency_str.replace(",",""));
}

function ParseRawJSON(pdfData) {
  let fundlist = [];
  let pdfpan = "";
  let curfund = null;
  let curtrans = { };
  let stage = 0;
  let widthFactor = pdfData.formImage.Width / (8.5 * 72);

  if (exports.Verbose) console.log('WidthFactor = ' + widthFactor);

  for (pdfPageIdx in pdfData.formImage.Pages) {
    let entryheaders = { };
    let pdfPage = pdfData.formImage.Pages[pdfPageIdx];

    for (pdfTextIdx in pdfPage.Texts) {
      let pdfText = pdfPage.Texts[pdfTextIdx];

      // Get table positions
      if (Object.keys(entryheaders).length < 5)
      {
        if (pdfText.R[0].T === "Date")
        {
          entryheaders[pdfText.R[0].T] = pdfText.x;
        }
        else if (pdfText.R[0].T === "Amount"
          || pdfText.R[0].T === "Price"
          || pdfText.R[0].T === "Balance"
          || pdfText.R[0].T === "Units")
        {
          entryheaders[pdfText.R[0].T] = pdfText.x + pdfText.w * widthFactor;
        }
      }
      // Got table positions and entries not started yet
      else if (stage == 0) {
        //  Get folio
        if (pdfText.R[0].T.startsWith("Folio%20No")) {
          let folioNo = decodeURIComponent(pdfText.R[0].T.substr(16));
          let panIdx = pdfTextIdx - 4;
          let panStr = pdfPage.Texts[panIdx].R[0].T;

          if (panStr.startsWith("KYC")) {
            panIdx--;
            panStr = pdfPage.Texts[panIdx].R[0].T;
          }

          curfund = {
            Name : decodeURIComponent(pdfPage.Texts[panIdx + 2].R[0].T),
            Labels : {Folio: folioNo},
            Transactions : []
          };

          if (panStr.startsWith("PAN")) {
            pdfpan = curfund.Labels.PAN = decodeURIComponent(panStr.substr(9));
          }
          else {
            curfund.Labels.PAN = pdfpan;
          }

          fundlist.push(curfund);
        }
        else if (pdfText.R[0].T.startsWith("%20Opening")) {
          ++stage;
          curtrans = {};
        }
      }
      // Reading table entries
      else if (stage == 1) {
        if (pdfText.R[0].T.startsWith("NAV")) {
          --stage;
        }
        else {
          let paramDist = 1;
          let chosen = -1;
          for (let param in entryheaders) {
            let tokenPos = pdfText.x;
            if (param != "Date") {
              tokenPos += pdfText.w * widthFactor;
            }
            if (Math.abs(entryheaders[param] - tokenPos) < paramDist) {
              paramDist = Math.abs(entryheaders[param] - tokenPos);
              chosen = param;
            }
          }
          if (chosen != -1) {
            if (curtrans[chosen] != null) {
              if (exports.Verbose) console.log(fundlist.length + ' - Incomplete entry ' + curtrans.Date);
              curtrans = {};
            }
            if (chosen == "Date") {
              curtrans[chosen] = pdfText.R[0].T;
            }
            else {
              let valueStr = decodeURIComponent(pdfText.R[0].T);

              if (valueStr.includes('('))
                curtrans[chosen] = -ParseCurrency(valueStr.substr(1, valueStr.length - 2));
              else
                curtrans[chosen] = ParseCurrency(valueStr);
            }
            if (exports.Verbose) console.log(chosen + " : " + pdfText.R[0].T);
          }

          if (Object.keys(curtrans).length == 5) {
            if (exports.Verbose) console.log(fundlist.length + ' - Pushing entry ' + curtrans.Date);
            curfund.Transactions.push(curtrans);
            curtrans = {};
          }
        }
      }
    }
  }

  return fundlist;
}

exports.LoadPdf = function (filepath, pdf_pass, out_cb)
{
   // Parse the file with pdf2json
    const fs = require('fs');
    const PDFParser = require("pdf2json");
    const filename = filepath.split('\\').pop().split('/').pop();

    let pdfParser = new PDFParser(null, false);
    var outData = {};

    pdfParser.on("pdfParser_dataError", errData => {
      outData["Success"] = false;
      outData["Reason"] = errData.parserError;
      out_cb(outData);
    });
    pdfParser.on("pdfParser_dataReady", pdfData => {
      if (outData.Success == undefined) {
        if (exports.Verbose) console.log("Begin parsing structure for " + filename);
        outData["Output"] = ParseRawJSON(pdfData);
        if (outData.Output == undefined) {
          outData["Success"] = false;
          outData["Reason"] = "Couldn't parse CAS structure from file, unsupported PDF.";
        }
        outData["Success"] = true;
        out_cb(outData);
      }
    });

    if (exports.Verbose) console.log("Opening PDF file " + filename);
    pdfParser.loadPDF(filepath.toString(), {password:pdf_pass.toString()});
}


function GetFinYear(dateStr) {
  let tDate = new Date(dateStr);
  if (tDate.getMonth() >= 3) {
    return '' + (1 + tDate.getFullYear());
  }
  else {
    return '' + tDate.getFullYear();
  }
}

function PrepareGainsCSV(fundList)
{
  let csvOutput = '"PAN","Fund","Units","Sell Date","Sell Price","Sell Amount","Buy Date","Buy Price","Cost Amount","Gain/Loss","Duration (Years)","FY",\n';

  for (let fIdx in fundList) {
    let fund = fundList[fIdx];
    let unitCount = [];

    // fund realized gain/loss
    for (let tIdx in fund.Transactions) {
      let trans = fund.Transactions[tIdx];

      if (trans.Units > 0) {
        // It's a buy
        unitCount.push({Price:trans.Price, Units:trans.Units, Date:trans.Date});
      }
      else {
        let redeemUnits = -trans.Units;

        while (redeemUnits > 0 && unitCount.length > 0) {
          let sellDate = trans.Date;
          let sellPrice = trans.Price;
          let buyDate = unitCount[0].Date;
          let buyPrice = unitCount[0].Price;
          let durationInYears = ((new Date(sellDate)).getTime() - (new Date(buyDate)).getTime()) / (1000 * 3600 * 24 * 365);
          let gainUnits = 0;
          let gainAmount = 0;

          if (unitCount[0].Units > redeemUnits) {
            gainUnits = redeemUnits;
            gainAmount = (trans.Price - unitCount[0].Price)*gainUnits;
            unitCount[0].Units -= redeemUnits;
            redeemUnits = 0;
          }
          else {
            gainUnits = unitCount[0].Units;
            gainAmount = (trans.Price - unitCount[0].Price)*gainUnits;
            redeemUnits -= unitCount[0].Units;
            unitCount.shift();
          }

          let fYear = GetFinYear(sellDate);

          csvOutput +=
            '"' + fund.Labels.PAN + '",' +
            '"' + fund.Name + '",' +
            '"' + gainUnits + '",' +
            '"' + sellDate + '",' +
            '"' + sellPrice + '",' +
            '"' + (sellPrice * gainUnits) + '",' +
            '"' + buyDate + '",' +
            '"' + buyPrice + '",' +
            '"' + (buyPrice * gainUnits) + '",' +
            '"' + gainAmount + '",' +
            '"' + durationInYears + '",' +
            '"' + fYear + '",\n';
        }
      }
    }
  }

  return csvOutput;
}

function PrepareTransactionCSV(fundList)
{
  let csvOutput = '"PAN","Folio","Fund","Date","Units","Amount","Price","Balance",\n';

  for (let fIdx in fundList) {
    let fund = fundList[fIdx];

    for (let tIdx in fund.Transactions) {
      let trans = fund.Transactions[tIdx];

      csvOutput +=
        '"' + fund.Labels.PAN + '",' +
        '"' + fund.Labels.Folio + '",' +
        '"' + fund.Name + '",' +
        '"' + trans.Date + '",' +
        '"' + trans.Units + '",' +
        '"' + trans.Amount + '",' +
        '"' + trans.Price + '",' +
        '"' + trans.Balance + '",\n';
    }
  }

  return csvOutput;
}

exports.ConvertToCSV = function (fundList, computeGains = false)
{
  if (computeGains) {
    return PrepareGainsCSV(fundList);
  }
  else {
    return PrepareTransactionCSV(fundList);
  }
}