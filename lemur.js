const Web3 = require('web3');
const MongoClient = require('mongodb').MongoClient;
const fetch = require('node-fetch');
const settings = require('./settings.json');
const environment = process.env.ENVIRONMENT || 'development';
const mongoURI = process.env.MONGODB_URI
      || 'mongodb://localhost:27017/coinosis';

const providerURI = settings[environment].providerURI;
const provider = new Web3.providers.WebsocketProvider(providerURI);
const web3 = new Web3(provider);
const dbClient = new MongoClient(mongoURI, { useUnifiedTopology: true });
const contractAddress = settings[environment].contractAddress;
const backendURI = settings[environment].backendURI;

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

  const handleTx = async hash => {
    let tx = await web3.eth.getTransaction(hash);
    if (tx.to !== contractAddress) return;
    console.log(tx.value);
    const ethPrice = await getEthPrice();
    console.log(ethPrice);
    const feeETH = feeUSD / ethPrice;
    const feeWei = web3.utils.toWei(String(feeETH));
    const feeThreshold = feeWei * threshold;
    console.log(feeThreshold);
    if (tx.value < feeThreshold) return;
    while (tx.blockHash === null) {
      tx = await web3.eth.getTransaction(hash);
      console.log(tx.blockHash);
    }
    await events.updateOne(
      { url: eventUrl },
      { $addToSet: { attendees: tx.from }}
    );
    const event = await events.findOne(
      { url: eventUrl },
      { _id: 0, attendees: 1 }
    );
    console.log(event.attendees);
  }

  const subscription = web3.eth.subscribe('pendingTransactions')
        .on('data', hash => {
          handleTx(hash);
        }).on('error', err => {
          console.error(err);
        });

});
