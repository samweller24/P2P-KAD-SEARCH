let net = require("net"),
  kadPTPpacket = require("./kadPTPmessage"),
  singleton = require("./Singleton");
var ITPpacket = require("./ITPResponse");
var kadPTPrequest = require("./kadPTPrequest");
const fs = require('fs');

let myReceivingPort = null;
let mySendingPort = null;

//variables needed for execution
//peers list
let peersList = [];
//variable for local image
let localImage;
//nicknames
var nickNames = {};
//client ip
var clientIP = {};
//timestamp
var startTimestamp = {};
//DHT
let DHT = {};
//receievd image for search
let receivedImage = null;

//image extension mapping
let imageExtension = {
  1: "bmp",
  2: "jpeg",
  3: "gif",
  4: "png",
  5: "tiff",
  15: "raw",
};

module.exports = {
  //init dht from KADpeer
  initDHT: function (table){
    DHT = table;
  },
  //init local image from KADpeer
  initLocalImageList: function (localImageList){
    localImage = localImageList;
  },
  //handle image qeuery 
  handleImageQuery: function (sock){
    assignClientName(sock, nickNames);
    console.log(
      "\n" +
        nickNames[sock.id] +
        " is connected at timestamp: " +
        startTimestamp[sock.id]
    );
    //image requests
    sock.on("data",  (data) => {
      handleImage(data, sock); 
    });
    //handle close
    sock.on("close", function () {
      handleClientLeaving(sock);
    });
  },
  handleClientJoining: function (sock) {
    // accept anyways in this assignment
    handleClient(sock, DHT);

  },
  handleCommunications: function (clientSocket, clientName) {
    communicate(clientSocket, clientName, DHT);
  }
};

//function to handle image requests
function handleImage(data, sock){
  //get reqeust info
  let version = parseBitPacket(data, 0, 4);
  let requestTypeITP = parseBitPacket(data, 24, 8);
  let responseTypeKAD = parseBitPacket(data, 4, 8);;
  //if reqeust from client and TIP
  if(requestTypeITP == 0 && responseTypeKAD != 4){
    //print
    console.log("\nITP packet received:");
    printPacketBit(data);
    //reqeust mapping
    let requestName = {
      0: "Query",
      1: "Found",
      2: "Not found",
      3: "Busy",
    };
    //reteuive packet info
    let timeStamp = parseBitPacket(data, 32, 32);
    let imageType = parseBitPacket(data, 64, 4);
    let imageTypeName = imageExtension[imageType];
    let imageNameSize = parseBitPacket(data, 68, 28);
    let imageName = bytesToString(data.slice(12, 13 + imageNameSize));
 
    //log
    console.log(
      "\n" +
        nickNames[sock.id] +
       " requests:" +
       "\n    --ITP version: " +
       version +
       "\n    --Timestamp: " +
        timeStamp +
       "\n    --Request type: " +
       requestName[requestTypeITP] +
       "\n    --Image file extension(s): " +
        imageTypeName +
       "\n    --Image file name: " +
        imageName +
        "\n"
    );

    //does server have query image name in local image
    let requestedImage = imageName + '.' + imageTypeName;
    //if it does
    if(requestedImage == localImage[1]){
      if (version == 7) {  
        //retrive name and file data
        let imageFullName = imageName + "." + imageTypeName;
        let imageData = fs.readFileSync(imageFullName);   

        //create response packet
        ITPpacket.init(
          version,
          1, // response type
          singleton.getSequenceNumber(), // sequence number
          singleton.getTimestamp(), // timestamp
          imageData, // image data
        );
        //write to client and end
        sock.write(ITPpacket.getBytePacket());
        sock.end();
      } else {
        console.log("The protocol version is not supported");
        sock.end();
      }
    }else{
      //not local,send out search query
      //generate key
      let keyID = singleton.getKeyID(requestedImage);
      let closestPeer;
      let max;
      //search for closest peer
      for(let i = 0; i < DHT.table.length; i++){
        let peerID = DHT.table[i].node.peerID;
        //track distance betweeen each peer
        let result = singleton.XORing(singleton.Hex2Bin(peerID), singleton.Hex2Bin(keyID));
        //set closest for each peer
        if(i == 0){
          max = result;
          closestPeer = [DHT.table[0].node.peerIP, DHT.table[0].node.peerPort];
        }
        if(result < max){
          closestPeer = [DHT.table[i].node.peerIP, DHT.table[i].node.peerPort];
        }
      }
      //once closest is found
      //send search request to node
      let nodeIP = closestPeer[0];
      let nodePORT = closestPeer[1];
      //create socket with cloest peer
      let searchSocket = new net.Socket();
      //connect and send message
      searchSocket.connect(nodePORT, nodeIP, function () {
        console.log(`Sending KADptp request message to ${nodeIP}:${nodePORT}`);
        //init search query
        kadPTPrequest.init(7,3,DHT,[sock.localAddress, sock.localPort],imageType,imageName);
        //write query to cloest per
        searchSocket.write(kadPTPrequest.getPacket());
        searchSocket.end();
      });

      //set timeout to wait for search packet to be returned 
      setTimeout(() => {
        //if received image data
        if (receivedImage){
          //parse and send
          let imageData = receivedImage.slice(12);
          ITPpacket.init(
            7,
            3, // response type
          singleton.getSequenceNumber(), // sequence number
          singleton.getTimestamp(), // timestamp
          imageData, // image data
          );
          //write and end
          sock.write(ITPpacket.getBytePacket());
          sock.end();
          //set back to null
          receivedImage = null;
        }
            }, 500)
    }
  }

  if (responseTypeKAD == 4) {
    receivedImage = data;
  }
}

function handleClient(sock, DHT) {
  let kadPacket = null;
  let joiningPeerAddress = sock.remoteAddress + ":" + sock.remotePort;

  // initialize client DHT table
  let joiningPeerID = singleton.getPeerID(sock.remoteAddress, sock.remotePort)
  let joiningPeer = {
    peerName: "",
    peerIP: sock.remoteAddress,
    peerPort: sock.remotePort,
    peerID: joiningPeerID
  };

  // Triggered only when the client is sending kadPTP message
  sock.on('data', (message) => {
    kadPacket = parseMessage(message);
    if (kadPacket.msgType == 3) {
      //if search message
      // //get requested name
      let requestedImage = kadPacket.imageName + '.' + imageExtension[kadPacket.imgType];
      //if eqaul to local host
      if(requestedImage == localImage[1]){
        //log receievd and get file data
        console.log('Received kadPTP search request from: ' + kadPacket.senderName);
        let imageData = fs.readFileSync(requestedImage);
        //init packet
        ITPpacket.init(7,4,singleton.getSequenceNumber(), singleton.getTimestamp(), imageData);
        //create sicket and send back
        let searchResponse = new net.Socket();
        searchResponse.connect(kadPacket.originPORT, kadPacket.originIP, function () {
          searchResponse.write(ITPpacket.getBytePacket());
          searchResponse.end();
        });
      }else{
        //send out search query using same process
        let keyID = singleton.getKeyID(requestedImage);
        let closestPeer;
        let max;
        for(let i = 0; i < DHT.table.length; i++){
          let peerID = DHT.table[i].node.peerID;
          let result = singleton.XORing(singleton.Hex2Bin(peerID), singleton.Hex2Bin(keyID));
          if(i == 0){
            max = result;
            closestPeer = [DHT.table[0].node.peerIP, DHT.table[0].node.peerPort];
          }
          if(result < max){
            closestPeer = [DHT.table[i].node.peerIP, DHT.table[i].node.peerPort];
          }
        }
        //send search request to node
        let nodeIP = closestPeer[0];
        let nodePORT = closestPeer[1];
        //create socket with closet node and send search packet
        let searchSocket = new net.Socket();
        searchSocket.connect(nodePORT, nodeIP, function () {
          //init same search message and send and end
          kadPTPrequest.init(7,3,kadPacket.senderName,[kadPacket.originIP, kadPacket.originPORT],kadPacket.imgType,kadPacket.imageName)
          searchSocket.write(kadPTPrequest.getPacket());
          searchSocket.end();
        });
      }
    } 
  });

  sock.on('end', () => {
    // client edded the connection
    if (kadPacket) {
      // Here, the msgType cannot be 1. It can be 2 or greater
      if (kadPacket.msgType == 2) {
        console.log("Received Hello Message from " + kadPacket.senderName);

        if (kadPacket.peersList.length > 0) {
          let output = "  along with DHT: ";
          // now we can assign the peer name
          joiningPeer.peerName = kadPacket.senderName;
          for (var i = 0; i < kadPacket.peersList.length; i++) {
            output +=
              "[" +
              kadPacket.peersList[i].peerIP + ":" +
              kadPacket.peersList[i].peerPort + ", " +
              kadPacket.peersList[i].peerID +
              "]\n                  ";
          }
          console.log(output);
        }

        // add the sender into the table only if it is not exist or set the name of the exisiting one
        let exist = DHT.table.find(e => e.node.peerPort == joiningPeer.peerPort);
        if (exist) {
          exist.node.peerName = joiningPeer.peerName;
        } else {
          pushBucket(DHT, joiningPeer);
        }

        // Now update the DHT table
        updateDHTtable(DHT, kadPacket.peersList);
      }
      
    } else {
      // This was a bootstrap request
      console.log("Connected from peer " + joiningPeerAddress + "\n");
      // add the requester info into server DHT table
      pushBucket(DHT, joiningPeer);
    }
  });

  if (kadPacket == null) {
    // This is a bootstrap request
    // send acknowledgment to the client
    kadPTPpacket.init(7, 1, DHT);
    sock.write(kadPTPpacket.getPacket());
    sock.end();
  }
}

function communicate(clientSocket, clientName, DHT) {
  let senderPeerID = singleton.getPeerID(clientSocket.remoteAddress, clientSocket.remotePort)

  clientSocket.on('data', (message) => {
    let kadPacket = parseMessage(message);

    let senderPeerName = kadPacket.senderName;
    let senderPeer = {
      peerName: senderPeerName,
      peerIP: clientSocket.remoteAddress,
      peerPort: clientSocket.remotePort,
      peerID: senderPeerID
    };

    if (kadPacket.msgType == 1) {
      // This message comes from the server
      console.log(
        "Connected to " +
        senderPeerName +
        ":" +
        clientSocket.remotePort +
        " at timestamp: " +
        singleton.getTimestamp() + "\n"
      );

      // Now run as a server
      myReceivingPort = clientSocket.localPort;
      let localPeerID = singleton.getPeerID(clientSocket.localAddress, myReceivingPort);
      let serverPeer = net.createServer();
      serverPeer.listen(myReceivingPort, clientSocket.localAddress);
      console.log(
        "This peer address is " +
        clientSocket.localAddress +
        ":" +
        myReceivingPort +
        " located at " +
        clientName +
        " [" + localPeerID + "]\n"
      );

      // Wait for other peers to connect
      serverPeer.on("connection", function (sock) {
        // again we will accept all connections in this assignment
        handleClient(sock, DHT);
      });

      console.log("Received Welcome message from " + senderPeerName) + "\n";
      if (kadPacket.peersList.length > 0) {
        let output = "  along with DHT: ";
        for (var i = 0; i < kadPacket.peersList.length; i++) {
          output +=
            "[" +
            kadPacket.peersList[i].peerIP + ":" +
            kadPacket.peersList[i].peerPort + ", " +
            kadPacket.peersList[i].peerID +
            "]\n                  ";
        }
        console.log(output);
      } else {
        console.log("  along with DHT: []\n");
      }

      // add the bootstrap node into the DHT table but only if it is not exist already
      let exist = DHT.table.find(e => e.node.peerPort == clientSocket.remotePort);
      if (!exist) {
        pushBucket(DHT, senderPeer);
      } else {
        console.log(senderPeer.peerPort + " is exist already")
      }

      updateDHTtable(DHT, kadPacket.peersList)

    }else {
      // Later we will consider other message types.
      console.log("The message type " + kadPacket.msgType + " is not supported")
    }
  });

  clientSocket.on("end", () => {
    // disconnected from server
    sendHello(DHT)
  })
}

function updateDHTtable(DHTtable, list) {
  // Refresh the local k-buckets using the transmitted list of peers. 

  refreshBucket(DHTtable, list)
  console.log("Refresh k-Bucket operation is performed.\n");

  if (DHTtable.table.length > 0) {
    let output = "My DHT: ";
    for (var i = 0; i < DHTtable.table.length; i++) {
      output +=
        "[" +
        DHTtable.table[i].node.peerIP + ":" +
        DHTtable.table[i].node.peerPort + ", " +
        DHTtable.table[i].node.peerID +
        "]\n        ";
    }
    console.log(output);
  }

}

//updated parse message to accept multiple message types
function parseMessage(message) {
  let kadPacket = {}
  peersList = [];
  let bitMarker = 0;
  kadPacket.version = parseBitPacket(message, 0, 4);
  bitMarker += 4;
  kadPacket.msgType = parseBitPacket(message, 4, 8);
  bitMarker += 8;
  //if server response
  if(kadPacket.msgType === 1 || kadPacket.msgType === 2){
    let numberOfPeers = parseBitPacket(message, 12, 8);
    bitMarker += 8;
    let SenderNameSize = parseBitPacket(message, 20, 12);
    bitMarker += 12;
    kadPacket.senderName = bytes2string(message.slice(4, SenderNameSize + 4));
    bitMarker += SenderNameSize * 8;

    if (numberOfPeers > 0) {
      for (var i = 0; i < numberOfPeers; i++) {
        let firstOctet = parseBitPacket(message, bitMarker, 8);
        bitMarker += 8;
        let secondOctet = parseBitPacket(message, bitMarker, 8);
        bitMarker += 8;
        let thirdOctet = parseBitPacket(message, bitMarker, 8);
        bitMarker += 8;
        let forthOctet = parseBitPacket(message, bitMarker, 8);
        bitMarker += 8;
        let port = parseBitPacket(message, bitMarker, 16);
        bitMarker += 16;
        let IP = firstOctet + "." + secondOctet + "." + thirdOctet + "." + forthOctet;
        let peerID = singleton.getPeerID(IP, port);
        let aPeer = {
          peerIP: IP,
          peerPort: port,
          peerID: peerID
        };
        peersList.push(aPeer);
      }
    }
    kadPacket.peersList = peersList;   
  //if search packet
  } else if (kadPacket.msgType === 3) {
    bitMarker += 8;
    let SenderNameSize = parseBitPacket(message, 20, 12);
    bitMarker += 12;
    kadPacket.senderName = bytes2string(message.slice(4, SenderNameSize + 4));
    bitMarker += SenderNameSize * 8;
    //get origin ip and host 
    let firstOctet = parseBitPacket(message, bitMarker, 8);
    bitMarker += 8;
    let secondOctet = parseBitPacket(message, bitMarker, 8);
    bitMarker += 8;
    let thirdOctet = parseBitPacket(message, bitMarker, 8);
    bitMarker += 8;
    let forthOctet = parseBitPacket(message, bitMarker, 8);
    bitMarker += 8;
    let port = parseBitPacket(message, bitMarker, 16);
    bitMarker += 16;
    //join ip
    kadPacket.originIP = firstOctet + "." + secondOctet + "." + thirdOctet + "." + forthOctet;
    kadPacket.originPORT = port;
    //get image type
    kadPacket.imgType = parseBitPacket(message, bitMarker, 4);
    bitMarker += 4;
    let imageNameSize = parseBitPacket(message, bitMarker, 28);
    bitMarker += 28;
    bytes = bitMarker/8;
    kadPacket.imageName = bytes2string(message.slice(bytes, imageNameSize + bytes));
  }
  return kadPacket;
}

function refreshBucket(T, peersList) {
  peersList.forEach(P => {
    pushBucket(T, P);
  });
}

// pushBucket method stores the peer’s information (IP address, port number, and peer ID) 
// into the appropriate k-bucket of the DHTtable. 
function pushBucket(T, P) {
  // First make sure that the given peer is not the loacl peer itself, then  
  // determine the prefix i which is the maximum number of the leftmost bits shared between  
  // peerID the owner of the DHTtable and the given peer ID. 

  if (T.owner.peerID != P.peerID) {
    let localID = singleton.Hex2Bin(T.owner.peerID);
    let receiverID = singleton.Hex2Bin(P.peerID);
    // Count how many bits match
    let i = 0;
    for (i = 0; i < localID.length; i++) {
      if (localID[i] != receiverID[i])
        break;
    }

    let k_bucket = {
      prefix: i,
      node: P
    };

    let exist = T.table.find(e => e.prefix === i);
    if (exist) {
      // insert the closest 
      if (singleton.XORing(localID, singleton.Hex2Bin(k_bucket.node.peerID)) <
        singleton.XORing(localID, singleton.Hex2Bin(exist.node.peerID))) {
        // remove the existing one
        for (var k = 0; k < T.table.length; k++) {
          if (T.table[k].node.peerID == exist.node.peerID) {
            console.log("** The peer " + exist.node.peerID + " is removed and\n** The peer " + 
            k_bucket.node.peerID + " is added instead")
            T.table.splice(k, 1);
            break;
          }
        }
        // add the new one    
        T.table.push(k_bucket);
      }
    } else {
      T.table.push(k_bucket);
    }
  }

}
// The method scans the k-buckets of T and send hello message packet to every peer P in T, one at a time. 
function sendHello(T) {
  let i = 0;
  // we use echoPeer method to do recursive method calls
  echoPeer(T, i);
}

// This method call itself (T.table.length) number of times,
// each time it sends hello messags to all peers in T
function echoPeer(T, i) {
  setTimeout(() => {
    let sock = new net.Socket();
    sock.connect(
      {
        port: T.table[i].node.peerPort,
        host: T.table[i].node.peerIP,
        localPort: T.owner.peerPort
      },
      () => {
        // send Hello packet 
        kadPTPpacket.init(7, 2, T);
        sock.write(kadPTPpacket.getPacket());
        setTimeout(() => {
          sock.end();
          sock.destroy();
        }, 500)
      }
    );
    sock.on('close', () => {
      i++;
      if (i < T.table.length) {
        echoPeer(T, i)
      }
    })
    if (i == T.table.length - 1) {
      console.log("Hello packet has been sent.\n");
    }
  }, 500)
}

function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    if (array[i] > 0) result += String.fromCharCode(array[i]);
  }
  return result;
}

// return integer value of a subset bits
function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    // let us get the actual byte position of the offset
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

function assignClientName(sock, nickNames) {
  sock.id = sock.remoteAddress + ":" + sock.remotePort;
  startTimestamp[sock.id] = singleton.getTimestamp();
  var name = "Client-" + startTimestamp[sock.id];
  nickNames[sock.id] = name;
  clientIP[sock.id] = sock.remoteAddress;
}

function handleClientLeaving(sock) {
  console.log(nickNames[sock.id] + " closed the connection");
}

//function to parse itp
function parseITP(data){
  let packet = {}
  packet.version = parseBitPacket(data, 0, 4);
  packet.resType = parseBitPacket(data, 4, 8);
  packet.seqNum = parseBitPacket(data, 12, 16);
  packet.time = parseBitPacket(data, 32, 32);
  packet.imgLen = parseBitPacket(data, 64, 32);
  packet.imgData = data.slice(12)

  return packet
  
}

// Prints the entire packet in bits format
function printPacketBit(packet) {
  var bitString = "";

  for (var i = 0; i < packet.length; i++) {
    // To add leading zeros
    var b = "00000000" + packet[i].toString(2);
    // To print 4 bytes per line
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
}
function bytesToString(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}


