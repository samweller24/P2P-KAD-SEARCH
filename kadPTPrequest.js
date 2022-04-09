//size of the response packet header:

//Fields that compose the header
let messageType;

module.exports = {
  header: "", //Bitstream of the cPTP header
  payload: "",
  request: "",

  init: function (ver, msgType, senderN, originalPeer, IT, imageName) {
    //fill out the default header fields:   

    //fill changing header fields:
    messageType = msgType;
    let senderName = stringToBytes(senderN);
    let imgName = stringToBytes(imageName);
    let imageNameLength = imgName.length;

    //build the header bistream:
    //--------------------------
    this.header = new Buffer.alloc(4 + senderName.length + 10);

    //fill out the header array of byte with PTP header fields
    // V
    storeBitPacket(this.header, ver, 0, 4);
    // Message type
    storeBitPacket(this.header, messageType, 4, 8);
    // Sender name size
    storeBitPacket(this.header, senderName.length, 20, 12);
    let byteMarker = 4;

    // Sender name
    let j = 0;
    let i = 0;
    for (i = byteMarker; i < senderName.length + byteMarker; i++) {
      this.header[i] = senderName[j++];
    }
    let bitMarker = i * 8;
    //ip info
    let origIP = originalPeer[0];
    let origPort = originalPeer[1];
    let firstOctet = origIP.split(".")[0];
    let secondOctet = origIP.split(".")[1];
    let thirdOctet = origIP.split(".")[2];
    let forthOctet = origIP.split(".")[3];

    //store other request info
    storeBitPacket(this.header, firstOctet * 1, bitMarker, 8);
    bitMarker += 8;
    storeBitPacket(this.header, secondOctet, bitMarker, 8);
    bitMarker += 8;
    storeBitPacket(this.header, thirdOctet, bitMarker, 8);
    bitMarker += 8;
    storeBitPacket(this.header, forthOctet, bitMarker, 8);
    bitMarker += 8;
    storeBitPacket(this.header, origPort, bitMarker, 16);
    bitMarker += 16;
    storeBitPacket(this.header, IT, bitMarker, 4);
    bitMarker += 4;
    storeBitPacket(this.header, imageNameLength, bitMarker, 28);
    bitMarker += 28;

     //build payload packet
    this.payload = new Buffer.alloc(imageNameLength);
    for (i = 0; i < imageNameLength; i++) {
        this.payload[i] = imgName[i];
    }

    this.request = new Buffer.concat([this.header, this.payload]);
  },

  //--------------------------
  //getpacket: returns the entire packet
  //--------------------------
  getPacket: function () {
    return this.request;
  },
};

function stringToBytes(str) {
  var ch,
    st,
    re = [];
  for (var i = 0; i < str.length; i++) {
    ch = str.charCodeAt(i); // get char
    st = []; // set up "stack"
    do {
      st.push(ch & 0xff); // push byte to stack
      ch = ch >>> 8; // shift value down by 1 byte
    } while (ch);
    // add stack contents to result
    // done because chars have "wrong" endianness
    re = re.concat(st.reverse());
  }
  // return an array of bytes
  return re;
}

// Store integer value into the packet bit stream
function storeBitPacket(packet, value, offset, length) {
  // let us get the actual byte position of the offset
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2);
  let j = number.length - 1;
  for (var i = 0; i < number.length; i++) {
    let bytePosition = Math.floor(lastBitPosition / 8);
    let bitPosition = 7 - (lastBitPosition % 8);
    if (number.charAt(j--) == "0") {
      packet[bytePosition] &= ~(1 << bitPosition);
    } else {
      packet[bytePosition] |= 1 << bitPosition;
    }
    lastBitPosition--;
  }
}
