let net = require("net");
let singleton = require("./Singleton");
let handler = require("./PeersHandler");
let os = require("os");
const fs = require('fs');

//init singleton
singleton.init();


// get current folder name 
let path = __dirname.split('/');
let myName = path[path.length - 1];

//set port using dict mapping
let portMapping = {
  'peer1':2001,
  'peer2':2055,
  'peer3':2077,
  'peer4':2044,
  'peer5':2005,
}

//get image name in directory
//list to store image
let localImageList = [];

let ifaces = os.networkInterfaces();
let HOST = "";
let PORT = portMapping[myName]; //get random port number
//port for image socket 3000> 5000<
let imgPORT = singleton.getImagePort();

// get the loaclhost ip address
Object.keys(ifaces).forEach(function (ifname) {
  ifaces[ifname].forEach(function (iface) {
    if ("IPv4" == iface.family && iface.internal !== false) {
      HOST = iface.address;
    }
  });
});

//init server id
let serverID = singleton.getPeerID(HOST, PORT);

// peer format
// {
//   peerName: peer's name (folder name)  
//   peerIP: peer ip address,
//   peerPort: peer port number,
//   peerID: the node DHT ID
// }
//
// DHT format
// {
//   owner: a peer
//   table: array of k_buckets  
// }
//
// k-bucket format (it is one object because k=1 in this assignment)
// {
//  prefix: i, (the maximum number of the leftmost bits shared between the owner of the DHTtable and the node below) 
//  node: peer
// }

if (process.argv.length > 2) {
  // call as node KADpeer [-p <serverIP>:<port>]

  // This peer runs as a client
  // this needs more work to validate the command line arguments
  let firstFlag = process.argv[2]; // should be -p
  let hostserverIPandPort = process.argv[3].split(":");
  let knownHOST = hostserverIPandPort[0];
  let knownPORT = hostserverIPandPort[1];

  // connect to the known peer address (any peer act as a server)
  startKADpeerDB();

  let clientSocket = new net.Socket();
  let port = PORT;
  clientSocket.connect({ port: knownPORT, host: knownHOST, localPort: port }, () => {
    // initialize client DHT table
    let clientID = singleton.getPeerID(clientSocket.localAddress, port);
    let clientPeer = {
      peerName: myName, // client name
      peerIP: clientSocket.localAddress,
      peerPort: port,
      peerID: clientID
    };

    //call db function
    setLocalImage();

    let clientDHTtable = {
      owner: clientPeer,
      table: []
    }

    //init DHT
    handler.initDHT(clientDHTtable);

    handler.handleCommunications(clientSocket, myName /*client name*/);
  });

} else {
  // call as node peer (no arguments)
  // run as a server
  //init database server 
  setLocalImage();
  startKADpeerDB(imgPORT);

  let serverSocket = net.createServer();
  serverSocket.listen(PORT, HOST);
  console.log(
    "This peer address is " + HOST + ":" + PORT + " located at " + myName /*server name*/ + " [" + serverID + "]"
  );

  // initialize server DHT table
  let serverPeer = {
    peerName: myName,
    peerIP: HOST,
    peerPort: PORT,
    peerID: serverID
  };

  let serverDHTtable = {
    owner: serverPeer,
    table: []
  }

  //init dht table
  handler.initDHT(serverDHTtable);

  serverSocket.on("connection", function (sock) {
    // received connection request
    handler.handleClientJoining(sock);
  });
}

//function to run DB
function startKADpeerDB(){
  //init server and listen based on ports
  let KADpeerDB = net.createServer();
  KADpeerDB.listen(imgPORT, HOST);
  
  //log line
  console.log('KADpeerDB server is started at timestamp: '+singleton.getTimestamp()+' and is listening on ' + HOST + ':' + imgPORT + '\n');

  //accept connection
  KADpeerDB.on('connection', function(sock) {
    handler.handleImageQuery(sock); //called for each client joining database
  });


};

//sets local image and sends info to handler
function setLocalImage(){
  //mappings for extensions looking for
  let imgExt = {
      'gif': true,
      'jpeg': true,
      'raw': true,
      'bmp': true,
      'png': true,
      'tiff': true
  }

  //set name function
  function setName(file){
    let imageID = singleton.getKeyID(file);
    localImageList = [imageID, file];
    handler.initLocalImageList(localImageList);
  }
    //read through files find image file in directory
  fs.readdir(__dirname, (err, files) => {
    files.forEach(file => {
      let fileExt = file.split(".");
      //if found set as local file
      if (imgExt[fileExt[1]] === true){
        setName(file) 
      }
    });
  });
  
  
}
