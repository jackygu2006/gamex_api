import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import bodyParser from "body-parser";
import expressPinoLogger from "express-pino-logger";
import { logger } from './utils/logger.js';
import cors from 'cors';
import mysql from 'mysql';
import date from 'date-and-time';
import dotenv from 'dotenv';
import { apiBaseUrl } from './config.js';

dotenv.config()
const TOTAL_BARS = 50;
const isHttps = process.env.isHttps * 1 === 1;
const httpsPort = process.env.httpsPort;
const httpPort = process.env.httpPort;

let credentials = null;
if(isHttps) {
  const privateKey  = fs.readFileSync('sslcert/server.key', 'utf8');
  const certificate = fs.readFileSync('sslcert/server.pem', 'utf8');
  credentials = {key: privateKey, cert: certificate};
}

const app = express();
app.use(bodyParser.json());
app.use(expressPinoLogger({ logger: logger }));
setCors(app);

const connection = mysql.createConnection({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
});

app.get(apiBaseUrl + '/test', function (req, res) {
   res.send('Hello World!');
})

function setCors(app) {
  const whitelist = [
    'http://127.0.0.1:3000', 
    'http://localhost:3000', 
    'http://app.gamex.plus',
    'https://app.gamex.plus',
    'https://www.chatpuppy.com',
    'https://chatpuppy.com'
  ];
  const origin = function (origin, callback) {
    if(origin === undefined) callback(null, true); // for postman testing ######
    else if (whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      console.log('Not allowed by CORS');
      // callback(new Error('Not allowed by CORS'))
    }
  };
  console.log('cors origin', origin);
  app.use(cors({
      origin,
      maxAge: 5,
      credentials: true,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'],
    })
  )
}

/**
 * Get Orders which has been bought.
 */
app.post(apiBaseUrl + '/getOrders', function (req, res) {
  const nftAddress = req.body.nftAddress;
  const tokenId = req.body.tokenId !== undefined ? req.body.tokenId : '';
  const from = req.body.from !== undefined ? req.body.from : Math.round((new Date().getTime()) / 1000) - TOTAL_BARS * interval;
  const to = req.body.to !== undefined ? req.body.to : 3000000000;
  const interval = req.body.interval !== undefined ? req.body.interval : 3600; //by 1min: 60, 30min: 1800, 60min: 3600, 4hours: 14400, 1day: 24*3600

  if(nftAddress === undefined) res.send({success: false, message: 'no nftAddress'});
  const whereTokenId = tokenId !== '' ? ` and tokenId = '${tokenId}'` : '';
  const whereTo = `and buyerTimestamp <= ${to}`;
  const whereFrom = `and startDate >= ${from}`;

  const sql = `select * from orders where nftAddress = '${nftAddress}' ${whereTokenId} ${whereFrom} ${whereTo} and buyerTimestamp > 0 and cancelSale = 0 order by buyerTimestamp`;
  console.log(sql);
  try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({
          success: false,
          message: 'no data'
        })
        else {
          let ticks = [];
          for(let i = 0; i < data.length; i++) {
            ticks.push({
              price: Number(data[i].startingPrice),
              quantity: Number(data[i].count),
              time: data[i].buyerTimestamp,
              formatTime: date.format(new Date(data[i].buyerTimestamp * 1000), 'YYYY/MM/DD HH:mm:ss')
            })
          }
          res.send({
            success: true,
            contractAddress: data[0].contractAddress,
            nftAddress: data[0].nftAddress,
            tokenId,
            interval,
            from,
            to,
            // ticks,
            ohlc: convertToOHLC(ticks, interval)
          });
        }  
      }
    })
  } catch (err) {
    res.send({success: false, message: err.message});
  }
})

/**
 * Get Onsale book.
 */
app.post(apiBaseUrl + '/getTradeDepth', function (req, res) {
  const nftAddress = req.body.nftAddress;
  const tokenId = req.body.tokenId !== undefined ? req.body.tokenId : '';
  const from = req.body.from !== undefined ? req.body.from : Math.round((new Date().getTime()) / 1000) - TOTAL_BARS * interval;
  const to = req.body.to !== undefined ? req.body.to : 3000000000;
  const step = req.body.step !== undefined ? Number(req.body.step) : 10000;
  const max = req.body.max !== undefined ? Number(req.body.max) : 10000000;
  const min = req.body.min !== undefined ? Number(req.body.min) : 10000;

  if(nftAddress === undefined) res.send({success: false, message: 'no nftAddress'});
  const whereTokenId = tokenId != '' ? ` and tokenId = '${tokenId}'` : '';
  const whereTo = `and startDate <= ${to}`;
  const whereFrom = `and startDate >= ${from}`;

  const sql = `select * from orders where nftAddress = '${nftAddress}' ${whereTokenId} ${whereFrom} ${whereTo} and isnull(buyerTimestamp) and startingPrice >= ${min} and startingPrice <= ${max} and cancelSale = 0 order by --startingPrice`;
  console.log(sql);
  try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({
          success: false,
          message: 'no data'
        })
        else {
          let ticks = [];
          for(let i = 0; i < data.length; i++) {
            ticks.push({
              price: Number(data[i].startingPrice),
              quantity: Number(data[i].count),
            });
          }
          const depths = getTradeDepth(ticks, step);
          res.send({
            success: true,
            contractAddress: data[0].contractAddress, // TODO: Raca has update contract on 12-6
            nftAddress: data[0].nftAddress,
            tokenId,
            from,
            step,
            to,
            data: depths,
          });  
        }
      }
    })
  } catch (err) {
    res.send({success: false, message: err.message})
  }

})

/**
 * Get Best vailable items 
 */
app.post(apiBaseUrl + '/getAvailableItems', function (req, res) {
  const nftAddress = req.body.nftAddress;
  const tokenId = req.body.tokenId !== undefined ? req.body.tokenId : '';
  const s = req.body.seconds != undefined ? req.body.seconds : '';
  const l = req.body.limit !== undefined ? req.body.limit : '';

  if(nftAddress === undefined || s === '') res.send({success: false, message: 'no nftAddress'});
  const whereTokenId = tokenId !== '' ? ` and tokenId = '${tokenId}'` : '';
  const limit = l !== '' ? ` limit ${l}` : '';
  const now = new Date().getTime();
  const from = s !== '' ? ` and startDate >= ${now / 1000 - s}` : '';
  const sql = `SELECT * FROM orders where nftAddress = '${nftAddress}' ${whereTokenId} ${from} and isnull(buyerTimestamp) and action = 2 order by --startingPrice ${limit}`;

  try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({success: false, message: 'no data'})
        else {
          let offers = [];
          for(let i = 0; i < data.length; i++) {
            offers.push({
              contractAddress: data[i].contractAddress,
              sellerAddress: data[i].sellerAddress,
              tokenId: data[i].tokenId,
              time: data[i].startDate,
              price: data[i].startingPrice,
              quantity: data[i].count,
              amount: data[i].amount,
              paymentToken: data[i].paymentToken,
              nftType: data[i].nftType,
              transactionHash: data[i].transactionHash,
              auctionId: data[i].auctionId,
            }) 
          }
          res.send({
            success: true,
            nftAddress: data[0].nftAddress,
            tokenId,
            data: offers,
          })
        }
      }
    })  
  } catch (err) {
    res.send({success: false, message: err.message});
  }

})

/**
 * Get tokenId onsale or sold
 */
app.post(apiBaseUrl + "/getTokenStatus", function(req, res) {
  const auctionId = req.body.auctionId;
  if(auctionId === undefined) res.send({success: false, message: 'wrong params'});

  const sql = `SELECT * from orders where auctionId='${auctionId}' and cancelSale = 0 limit 1`;
  try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length === 0) res.send({success: true, auctionId, result: false});
        else {
          const result = data[0].buyerTimestamp;
          console.log("result", result);
          if(result == null || result == '') res.send({success: true, auctionId, result: true});
          else res.send({success: true, auctionId, result: false});
        }
      }
    })
  } catch(err) {
    res.send({success: false, message: error.message});
  }
})

/**
 * Get exchange records for account
 */
app.post(apiBaseUrl + '/getUserHistory', function(req, res) {
  const nftAddress = req.body.nftAddress;
  const account = req.body.account;
  const from = req.body.from !== undefined ? req.body.from : Math.round((new Date().getTime()) / 1000) - 30 * 24 * 3600;
  const to = req.body.to !== undefined ? req.body.to : 3000000000;

  if(nftAddress === undefined || account === undefined) res.send({success: false, message: 'wrong params'});

  // as seller
  let sellData = [];
  let buyData = [];
  const ONSALE = 1;
  const SOLD = 2;
  const BOUGHT = 3;

  let sql = `select * from orders where nftAddress = '${nftAddress}' and sellerAddress = '${account}' and startDate >= ${from} and startDate <= ${to} and cancelSale = 0 order by startDate desc`;
  console.log('==1==', sql);
  try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        for(let i = 0; i < data.length; i++) {
          const d = data[i];
          sellData.push({
            account: d.sellerAddress,
            blockNumber: d.blockNumber,
            transactionHash: d.transactionHash,
            blockHash: d.blockHash,
            timestamp: d.startDate,

            nftAddress: d.nftAddress,
            auctionId: d.auctionId,
            tokenId: d.tokenId,
            count: d.count,
            paymentToken: d.paymentToken,
            amount: d.amount,
            price: d.startingPrice,
            nftType: d.nftType,
            status: d.buyerTimestamp > 0 ? SOLD : ONSALE,

            sellerAddress: d.sellerAddress,
            sellerBlockNumber: d.blockNumber,
            sellerTransactionHash: d.transactionHash,
            sellerBlockHash: d.blockHash,
            sellerTimestamp: d.startDate,

            buyerAddress: d.buyerAddress,
            buyerBlockNumber: d.buyerBlockNumber,
            buyerTransactionHash: d.buyerTransactionHash,
            buyerBlockHash: d.buyerBlockHash,
            buyerTimestamp: d.buyerTimestamp,
          });
        }

        // as buyer
        sql = `select * from orders where nftAddress = '${nftAddress}' and buyerAddress = '${account}' and buyerTimestamp >= ${from} and buyerTimestamp <= ${to} and cancelSale = 0 order by buyerTimestamp desc`;
        console.log('==2==', sql);
        try {
          connection.query(sql, function(error, data1, fields) {
            if(error) res.send({success: false, message: error.message});
            else {
              for(let i = 0; i < data1.length; i++) {
                const d = data1[i];
                buyData.push({
                  account: d.buyerAddress,
                  blockNumber: d.buyerBlockNumber,
                  transactionHash: d.buyerTransactionHash,
                  blockHash: d.buyerBlockHash,
                  timestamp: d.buyerTimestamp,

                  nftAddress: d.nftAddress,
                  auctionId: d.auctionId,
                  tokenId: d.tokenId,
                  count: d.count,
                  paymentToken: d.paymentToken,
                  amount: d.buyerAmount,
                  price: d.startingPrice,
                  nftType: d.nftType,
                  status: BOUGHT,

                  sellerAddress: d.sellerAddress,
                  sellerBlockNumber: d.blockNumber,
                  sellerTransactionHash: d.transactionHash,
                  sellerBlockHash: d.blockHash,
                  sellerTimestamp: d.startDate,

                  buyerAddress: d.buyerAddress,
                  buyerBlockNumber: d.buyerBlockNumber,
                  buyerTransactionHash: d.buyerTransactionHash,
                  buyerBlockHash: d.buyerBlockHash,
                  buyerTimestamp: d.buyerTimestamp,
                });
              }
            }
            res.send({
              success: true,
              nftAddress,
              account,
              from,
              to,
              sellData,
              buyData,
            })    
          })
        } catch (err) {
          res.send({success: false, message: error.message});
        }
      }
    })
  } catch(err) {
    res.send({success: false, message: error.message});
  }
})

/**
 * Get count of onsale orders
 */
app.post(apiBaseUrl + '/onsaleCount', function (req, res) {
	const nftAddress = req.body.nftAddress;
	const address = req.body.address;
	if(nftAddress === undefined) res.send({success: false, message: 'no nftAddress'});
	const sql = `SELECT * from orders where nftAddress = '${nftAddress}' and isnull(buyerTimestamp) and cancelSale = 0`;
	console.log(sql);
	try {
		connection.query(sql, function(error, data, fields) {
			if(error) res.send({success: false, message: error.message});
			else {
				if(data.length === 0) res.send({success: false, message: 'no data'});
				else {
					let onsaleCount = 0;
					let myListedCount = 0;
					for(let i = 0; i < data.length; i++) {
						if(data[i].sellerAddress === address) myListedCount++;
						else onsaleCount++;
					}
					res.send({
						success: true, 
						nftAddress: nftAddress, 
						data: {
							total: data.length,
							onsaleCount,
							myListedCount
						}
					});
				}
			}
		})
	} catch (err) {
		res.send({success: false, message: err.message})
	}
})

/**
 * Get count of use's nft
 */
app.post(apiBaseUrl + '/userNFTCount', function (req, res) {
	const nftAddress = req.body.nftAddress;
  const address = req.body.address;

	if(nftAddress === undefined || address === undefined) res.send({success: false, message: 'No nftaddress and limit'})
  const sql = `SELECT * FROM nfts as n where nftAddress = '${nftAddress}' and owner = '${address}' and n.tokenId not in (select tokenId from orders where orders.nftAddress = n.nftAddress and orders.cancelSale = 0 and isnull(orders.buyerTimestamp))`;
	console.log(sql);
	try {
		connection.query(sql, function(error, data, fields) {
			if(error) res.send({success: false, message: error.message});
			else {
				if(data.length === 0) res.send({success: false, message: 'no data'});
				else {
					let boxedCount = 0;
					let unboxedCount = 0;
					for(var i = 0; i < data.length; i++) {
						if(data[i].dna !== null) unboxedCount++;
						else boxedCount++;
					}
					res.send({
						success: true, 
						nftAddress: nftAddress, 
						data: {
							count: data.length,
							boxedCount,
							unboxedCount
						}
					});
				}
			}
		})
	} catch (err) {
		res.send({success: false, message: err.message})
	}
})

/**
 * Fetch marketplace onsale list
 */
app.post(apiBaseUrl + '/getOnsaleOrders', function (req, res) {
  const nftAddress = req.body.nftAddress;
	const address = req.body.address; // sender address
  const l = req.body.limit !== undefined ? req.body.limit : '';
  const o = req.body.offset != undefined ? req.body.offset : '';
  const order = req.body.order !== undefined ? req.body.order : ''; 
  // order can only be: 'startDate', 'blockNumber', 'auctionId', 'tokenId', '--amount', '--sellerAddress'
  const desc = req.body.desc !== undefined ? req.body.desc === 1 ? "desc" : '' : 'desc'; // order by desc? 1 or 0, default is 1

  if(nftAddress === undefined || address === undefined || l === '' || o === '') 
		res.send({success: false, message: 'Params is error!'});
  const limit = l !== '' && o !== '' ? ` limit ${l} offset ${o}` : '';
  const orderby = order !== '' ? `${order} ${desc}` : `createdAt ${desc}`; 
  const sql1 = `SELECT o.*, n.* FROM orders as o, nfts as n where o.sellerAddress = '${address}' and o.nftAddress = '${nftAddress}' and isnull(o.buyerTimestamp) and o.cancelSale = 0 and o.tokenId = n.tokenId and o.nftAddress = n.nftAddress order by --o.${orderby} ${limit}`;
  const sql2 = `SELECT o.*, n.* FROM orders as o, nfts as n where o.sellerAddress <> '${address}' and o.nftAddress = '${nftAddress}' and isnull(o.buyerTimestamp) and o.cancelSale = 0 and o.tokenId = n.tokenId and o.nftAddress = n.nftAddress order by --o.${orderby} ${limit}`;
  console.log(sql1);
  console.log(sql2);
  try {
    connection.query(sql1, function(error1, data1, fields) {
      if(error1) res.send({success: false, message: error1.message});
      else {
				connection.query(sql2, function(error2, data2, fields) {
					if(error2) res.send({success: false, message: error2.message});
					if(data1.length == 0 && data2.length == 0) res.send({success: false, message: 'no data'})
					else {
						const data = data1.concat(data2);
						let array = [];
						for(let i = 0; i < data.length; i++) {
							array.push({
								contractAddress: data[i].contractAddress,
								sellerAddress: data[i].sellerAddress,
								nftAddress: data[i].nftAddress,
								tokenId: data[i].tokenId,
								tokenURI: data[i].tokenURI,
								dna: data[i].dna,
								artifacts: data[i].artifacts,
								owner: data[i].owner,
								time: data[i].startDate,
								price: data[i].startingPrice,
								quantity: data[i].count,
								amount: data[i].amount,
								paymentToken: data[i].paymentToken,
								nftType: data[i].nftType,
								transactionHash: data[i].transactionHash,
								auctionId: data[i].auctionId,
							}) 
						}
						res.send({
							success: true,
							nftAddress: data[0].nftAddress,
							data: array,
						})
					}
				})
      }
    })  
  } catch (err) {
    res.send({success: false, message: err.message});
  }
})

/**
 * Get user's nfts
 */
app.post(apiBaseUrl + "/getUserNFTs", function(req, res) {
  const nftAddress = req.body.nftAddress;
  const address = req.body.address;
  const l = req.body.limit !== undefined ? req.body.limit : '';
  const o = req.body.offset != undefined ? req.body.offset : '';
  const order = req.body.order !== undefined ? req.body.order : ''; 
  // order can only be: tokenId
  const desc = req.body.desc !== undefined ? req.body.desc === 1 ? "desc" : '' : 'desc'; // order by desc? 1 or 0, default is 1

  if(nftAddress === undefined || address === undefined || l === '' || o === '') {
    res.send({success: false, message: 'Params is error!'})
  }
  const limit = l !== '' && o !== '' ? ` limit ${l} offset ${o}` : '';
  const orderby = order !== '' ? `${order} ${desc}` : `createdAt ${desc}`; 
  const sql1 = `SELECT n.* FROM nfts as n where isnull(n.dna) and nftAddress = '${nftAddress}' and owner = '${address}' and n.tokenId not in (select tokenId from orders where orders.nftAddress = n.nftAddress and orders.cancelSale = 0 and isnull(orders.buyerTimestamp)) order by --n.${orderby} ${limit}`;
  const sql2 = `SELECT n.* FROM nfts as n where not isnull(n.dna) and nftAddress = '${nftAddress}' and owner = '${address}' and n.tokenId not in (select tokenId from orders where orders.nftAddress = n.nftAddress and orders.cancelSale = 0 and isnull(orders.buyerTimestamp)) order by --n.${orderby} ${limit}`;
  console.log(sql1);
	console.log(sql2);
  try {
    connection.query(sql1, function(error1, data1, fields) {
      if(error1) res.send({success: false, message: error1.message});
      else {
				connection.query(sql2, function(error2, data2, fields) {
					if(error2) res.send({success: false, message: error2.message});
					if(data1.length == 0 && data2.length == 0) res.send({success: false, message: 'no data'})
					else {
						const data = data1.concat(data2);
						let array = [];
						for(let i = 0; i < data.length; i++) {
							array.push({
								nftAddress: data[i].nftAddress,
								tokenId: data[i].tokenId,
								tokenURI: data[i].tokenURI,
								dna: data[i].dna,
								artifacts: data[i].artifacts,
								owner: data[i].owner,              
							})
						}
						res.send({
							success: true,
							nftAddress: data[0].nftAddress,
							data: array,
						})
					}
	
				})
      }
    })  
  } catch (err) {
    res.send({success: false, message: err.message});
  }

})

/**
 * Convert tick to tick data to depth data
 * @param {*} ticks 
 */
const getTradeDepth = (ticks, step) => {
  let depths = [];
  let depthSum = [];
  const len = Math.floor((ticks[ticks.length - 1].price - ticks[0].price) / step) + 1;
  for(let i = 0; i < len; i++) {
    depths.push({
      priceStart: ticks[0].price + i * step,
      quantity: 0,
      amount: 0,
    });
    depthSum.push({
      priceStart: ticks[0].price + i * step,
      quantity: 0,
      amount: 0,
    })
  }
  for(let i = 0; i < ticks.length; i++) {
    const id = Math.floor((ticks[i].price - ticks[0].price) / step);
    depths[id].amount = depths[id].amount + ticks[i].price * ticks[i].quantity;
    depths[id].quantity = depths[id].quantity + ticks[i].quantity;
  }
  for(let i = 0; i < len; i++) {
    let sumQuantity = 0;
    let sumAmount = 0;
    for(let j = 0; j <= i; j++) {
      sumQuantity = sumQuantity + depths[j].quantity;
      sumAmount = sumAmount + depths[j].amount;
    }
    depthSum[i].quantity = sumQuantity;
    depthSum[i].amount = sumAmount;
  }
  return {
    depths,
    depthSum
  };
}

/**
 * Convert tick to tick data to OHLCV data
 * @param {*} ticks 
 * @param {*} interval 
 * @returns 
 */
const convertToOHLC = (ticks, interval) => {
  const start = 1638288000;
  let index = 0;
  const now = Math.round((new Date().getTime()) / 1000);
  for(let i = start; i < now; i = i + interval) {
    index++;
    if(ticks[0].time < i) break;
  }
  index--;
  let ohlcvs = [];
  let i = index;
  while(start + interval * (i + 1) < now) {
    const s = start + interval * i;
    const e = start + interval * (i + 1);
    const arr = ticks.filter(function(tick) {
      return tick.time >= s && tick.time < e;
    })
    i++;
    if(arr.length > 0) {
      const ohlc = {
        open: arr[0].price,
        high: Math.max.apply(Math, arr.map(function(o) { return o.price; })),
        low: Math.min.apply(Math, arr.map(function(o) { return o.price; })),
        close: arr[arr.length - 1].price,
        volumn: arr.reduce((sum, e) => sum + (e.quantity || 0), 0),
        amount: arr.reduce((sum, e) => sum + (e.quantity * e.price || 0), 0),
        average: (arr.reduce((sum, e) => sum + (e.price || 0), 0)) / arr.length,
        time: s,
      };
      ohlcvs.push(ohlc);
      // console.log(arr);
      // console.log(ohlc);
      // console.log('==========')
    }
  }
  return ohlcvs;
}

if(isHttps) {
  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(httpsPort, function () {
    logger.info(`Gamex api has started on https port ${httpsPort}.`);
  })  
}

const httpServer = http.createServer(app);
httpServer.listen(httpPort, function () {
  logger.info(`Gamex api has started on http port ${httpPort}.`);
})
