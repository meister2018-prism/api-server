/* パッケージ読み込み */
var express = require('express');
var router = express.Router();
var util = require('util');
var uuid = require('uuid');
const request = require('request');
const shiwori = require('./shiwori_auth');
var connection = require('./mysql_connection');

/* グローバル変数 */
const default_user_data = {
  //return_DATA
  "userinfo": {
    "name": "",
    "userid": "",
    "introduction": "",
    "create_date": 0,
    "update_date": 0,
    "email": "",
    "all_readtime": 0,
    "all_readbooks": 0,
    "speed": 0
  },
  "records": [],
  "bookmarks": [],
  "statistics":[]
};

/* 関数 */
function connection2(query) {
  return new Promise(function(resolve, reject) {
    connection.query(query, function(err, rows) {
      if(err) {
        console.log(err);
        reject("err");
      } else {
        resolve(rows);
      }
    });
  });
}

function UserCreate(body) {
  return new Promise(function(resolve, reject) {
    var date = new Date();
    var time_msec = date.getTime();
    var unixtime = Math.floor(time_msec / 1000);
    //uuid　または　ユニークなidの生成
    var userid = uuid.v4();
    let userdata = default_user_data;
    userdata.userinfo.name = body.name;
    userdata.userinfo.userid = userid;
    userdata.userinfo.create_date = unixtime;
    userdata.userinfo.update_date = unixtime;
    userdata.userinfo.email = body.email;
    //データベースアクセス
    var query = 'INSERT INTO USERS ';
    query += util.format('VALUES ("%s", "%s", "", 0, 0, 0, "%s", null, "%s", "%s", "%s")', userid, body.name, unixtime, unixtime, body.email, body.password);
    connection.query(query, function(err, rows) {
      if(err) {
        console.log(err);
        reject(err);
      } else {
        query = util.format('INSERT INTO STATISTICS VALUES ("%s")', userid);
        connection.query(query, function(err, rows) {
          if(err) {
            console.log(err);
            reject(err);
          } else {
            resolve(userdata);
          }
        });
      }
    });
  });
}

function getBookData(isbn) {
  return new Promise(function(resolve, reject) {
    const option = {
      method: "GET",
      url: "https://www.googleapis.com/books/v1/volumes",
      qs: {
        q: "isbn:" + isbn,
        Country: "JP"
      }
    };
    request(option, function(error, res, body) {
      if(!error && res.statusCode == 200) {
        var a = JSON.parse(body);
        var googlebook = a.items[0];
        var tmp = {
          "author": googlebook.volumeInfo.authors.join(","),
          "title": googlebook.volumeInfo.title,
          "imgUrl": googlebook.volumeInfo.imageLinks.thumbnail,
          "publication": "",
          "pageData":{
              "total": googlebook.volumeInfo.pageCount,
              "now"  : googlebook.volumeInfo.pageCount
          }
        };
        resolve(tmp);
      } else {
        reject(error);
      }
    });
  });
}


/* urlの受け口を実装する */
/* root(/) is /shiwori/. */

/* shiwori純正（signature）の確認 */
const check_signature = (req, res, next) => {
  console.log("aaaaa");
  if (shiwori.signature(req)) {
    next();
  } else {
    res.status(401).end();
    return;
  }
};

/* 登録 */
router.post('/signup', check_signature, async function(req, res, next) {
  const body = req.body;
  console.log("signup....");
  var db_res = await connection2("select * from USERS where email = '"+body.email+"'");
  if (db_res.length != 0) {
    res.status(400);
    res.json({"message": "this e-mail is used."});
    return;
  }
  UserCreate(body).then(function(value) {
    res.status(200);
    res.json(value);
  }).catch(function(err) {
    res.status(500);
    res.json({"message": "DataBase Error(can't write)"});
  });
});


router.post('/signin', check_signature, async function(req, res, next) {
  const body = req.body;
  console.log("singin...");
  var db_res = await connection2("select * from USERS where email = '"+body.email+"'");
  if (db_res.length != 1 || db_res[0].password != body.password) {
    res.status(400);
    res.json({"message": "e-mail or password is invalid."});
    return;
  }
  var query = "select * from RECORDS where userid = '" + db_res.id + "'";
  var user_info = db_res;
  var user_record = await connection2(query).catch((err) => null);
  query = "select * from STATISTICS where userid = '" + db_res.id + "'";
  var user_static = await connection2(query).catch((err) => null);
  query = "select * from BOOKMARKS where userid = '" + db_res.id + "'";
  var user_bookmark = await connection2(query).catch((err) => null);
  if (user_record == null | user_static == null | user_bookmark == null) {
    res.status(500);
    res.json({"message": "DataBase Error(can't read)"});
    return;
  }
  var date = new Date();
  var time_msec = date.getTime();
  var unixtime = Math.floor(time_msec / 1000);
  var userdata = default_user_data;
  userdata.userinfo.name = user_info[0].name;
  userdata.userinfo.userid = user_info[0].id;
  userdata.userinfo.introduction = user_info[0].inroduction;
  userdata.userinfo.all_readtime = user_info[0].all_readtime;
  userdata.userinfo.all_readbooks = user_info[0].all_readbooks;
  userdata.userinfo.create_date = user_info[0].create_date;
  userdata.userinfo.update_date = unixtime;
  userdata.userinfo.speed = user_info[0].speed;
  userdata.userinfo.email = user_info[0].email;
  for(var i=0; i<user_record.length; i++) {
    let tmp = {
      "id": user_record[i].id,
      "username": user_record[i].username,
      "star": user_record[i].star,
      "impression": user_record[i].impression,
      "readtime": user_record[i].readtime,
      "readspeed": user_record[i].readspeed,
      "update_date": user_record[i].update_date,
      "book": null
    };
    tmp.book = await getBookData(user_record[i].isbn).catch((err) => null);
    userdata.records.push(tmp);
  }
  for(var i=0; i>user_bookmark.length; i++) {
    let tmp = {
      "id": user_bookmark[i].id,
      "page": user_bookmark[i].page,
      "memo": user_bookmark[i].memo,
      "update_time": user_bookmark[i].update_date,
      "book": null
    };
    tmp.book = await getBookData(user_bookmark[i].isbn).catch((err) => null);
    userdata.bookmarks.push(tmp);
  }
  // とりあえずこれはYYYY-MM-hogehogeを同じ階層に並べているだけ
  if(!user_static) {
    var keys = Object.keys(user_static[0]);
    for(var i=0; keys.length; i++) {
      userdata.statistics[keys[i]] = user_static[0][keys[i]];
    }
  }
  res.status(200);
  res.json(userdata);
});

module.exports = router;
