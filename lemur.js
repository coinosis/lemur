const Web3 = require('web3');
const MongoClient = require('mongodb').MongoClient;
const fetch = require('node-fetch');
const settings = require('./settings.json');
const environment = process.env.ENVIRONMENT || 'development';
const mongoURI = process.env.MONGODB_URI
      || 'mongodb://localhost:27017/coinosis';

const {
  etherscanKey,
  backendURI,
  contractAddress,
  providerURI,
  startBlock,
  apiName,
} = settings[environment];

const provider = new Web3.providers.WebsocketProvider(providerURI);
const web3 = new Web3(provider);
const dbClient = new MongoClient(mongoURI, { useUnifiedTopology: true });
const addressEndpoint = `http://${apiName}.etherscan.io/api?module=account`
      + `&action=txlist&address=${contractAddress}&startblock=${startBlock}`
      + `&endblock=99999999&sort=asc&apikey=${etherscanKey}`;

if (process.argv.length < 3) {
  console.log(`usage:\n
node ./lemur.js <event-url> [threshold]
`);
  process.exit();
}
const eventUrl = process.argv[2];
const threshold = process.argv[3] || 0.9;

const getEthPrice = async () => {
  let response;
  do {
    response = await fetch(`${backendURI}/eth/price`);
    const data = await response.json();
    return data;
  } while (!response.ok)
}

dbClient.connect(async error => {

  const db = dbClient.db();
  const events = db.collection('events');
  const event = await events.findOne({ url: eventUrl }, { fee: 1 });
  const { fee: feeUSD } = event;

  const handleTx = async tx => {
    console.log(tx);
    const ethPrice = await getEthPrice();
    console.log(ethPrice);
    const feeETH = feeUSD / ethPrice;
    const feeWei = web3.utils.toWei(String(feeETH));
    const feeThreshold = feeWei * threshold;
    console.log(feeThreshold);
    if (tx.value < feeThreshold) return;
    if (tx.confirmations == 0) return;
    console.log('valid');
    const checksumFrom = web3.utils.toChecksumAddress(tx.from);
    await events.updateOne(
      { url: eventUrl },
      { $addToSet: { attendees: checksumFrom }}
    );
    const event = await events.findOne(
      { url: eventUrl },
      { _id: 0, attendees: 1 }
    );
    console.log(event.attendees);
  }

  const getTxList = async () => {
    console.log(addressEndpoint);
    const response = await fetch(`${addressEndpoint}`);
    if (!response.ok) {
      throw new Error(response.status);
    }
    const data = await response.json();
    if (data.status != 1) return;
    console.log(data);
    for(const i in data.result) {
      const tx = data.result[i];
      handleTx(tx);
    }
  }

  getTxList();
  setInterval(getTxList, 10000);

});
