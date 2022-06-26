const Fuse = require('fuse.js');
const bodyParser = require('body-parser')
const express = require('express');
const app = express();
const kuromoji = require('kuromoji');
const { json } = require('body-parser');
const { request } = require('express');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const session = require('express-session');
const exec = require('child_process').exec

app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static(__dirname + '/public'));

//connect
const list = [
    ""
]
const list_2 = [{
    name: '',
    session_id: '',
    text: ''
}]

// const pattern = "卒業 円 寝";

function get_token(text, tokenizer, pattern) {
    var tokens = tokenizer.tokenize(text);
    var token_array = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].pos === "名詞" || tokens[i].pos === "動詞" || tokens[i].pos === "形容詞" || tokens[i].pos === "副詞" || tokens[i].pos === "接頭詞") {
            if (tokens[i].surface_form.match(/[ぁ-んァ-ヶ]/g) && tokens[i].surface_form.length === 1) {
                //1文字のひらがな・カタカナは対象外にする
            } else {
                if (tokens[i].surface_form !== tokens[i].basic_form && tokens[i].basic_form !== '*') {
                    token_array.push(tokens[i].surface_form + '(' + tokens[i].basic_form + ')');
                } else {
                    if (tokens[i].reading) {
                        token_array.push(tokens[i].surface_form + '(' + tokens[i].reading + ')');
                    } else {
                        token_array.push(tokens[i].surface_form);
                    }
                }
            }
        }
    }

    const options = {
        ignoreLocation: true,
        threshold: 1.0,
        includeMatches: true,
    }
    const fuse = new Fuse(token_array, options);
    const search_result = fuse.search(pattern);

    hitlist = []
    if (search_result.length > 0) {
        for (let i = 0; i < search_result.length; i++) {
            const matches = search_result[i].matches;
            for (let j = 0; j < matches.length; j++) {
                hitlist.push({
                    matche: matches[j].value.split('(').shift(),
                });
            }
        }
    }
    group = hitlist.reduce((acc, cur) => {
        acc[cur.matche] = (acc[cur.matche] || 0) + 1;

        return acc;
    }, {});
    return group;
}
app.get('/search', (req, res) => {
    res.render('index', {
        content: list,
        atr: list_2,
    })

});
app.post('/search', (req, res) => {
    var text = req.body.search;
    var paragraph = req.body.paragraph;

    //xử lí dấu trong search
    text = text.replace(/[\[\]\(\)\{\}]/g, '');
    kuromoji.builder({ dicPath: "node_modules/kuromoji/dict" }).build(function(err, tokenizer) {
        if (err) {
            console.log(err);
        }
        var token_array = get_token(paragraph, tokenizer, text);
        //console each token and count
        var token_count = Object.keys(token_array).map(function(key) {
            return {
                token: key,
                count: token_array[key]
            };
        });
        console.log(token_count);
        res.send(token_count);
    });
})



//amivoice
app.post('/amivoice', (req, res) => {
    const sessionidList = [];
    const AmivoiceApiKey = "0BC9ABAF55FDC513174D350C30C5C03A2B72A041AAA81E468656A042A224A9EE588F";
    let filenames = fs.readdirSync('./public/audio');
    // check file in audio folder
    if (filenames.length === 0) {
        console.log('no audio file');
        res.end();
    }
    filenames = filenames.filter(function(file) {
        return path.extname(file).toLowerCase() === '.wav';
    });
    //upload audio file to amivoice
    const request = async() => {
        for (let i = 0; i < filenames.length; i++) {
            const file = fs.readFileSync('./public/audio/' + filenames[i]);
            const form = new FormData();
            form.append('a', file, filenames[i]);
            await axios
                .post('https://acp-api-async.amivoice.com/v1/recognitions?d=-a-general speakerDiarization=True&u=' + AmivoiceApiKey,
                    form, {
                        headers: {
                            ...form.getHeaders(),
                        }
                    })
                .then(res => {
                    const sessionid = res.data.sessionid;

                    sessionidList.push(sessionid);
                })
                .catch(err => {
                    console.log(err.message);
                });
        }
    }

    request().then(result => {
        console.log(sessionidList);
        const config = {
            headers: {
                "Authorization": "Bearer" + " " + AmivoiceApiKey
            }
        };
        let count = 0
        for (let i = 0; i < sessionidList.length; i++) {
            const countUp = () => {
                const session_id = sessionidList[i];
                axios
                    .get('https://acp-api-async.amivoice.com/v1/recognitions/' + session_id, config)
                    .then(res => {
                        status = res.data.status;
                        console.log(status);
                        //Success
                        if (status === 'completed') {
                            const text = res.data.text;
                            list.push(text);
                            list_2.push({
                                name: filenames[i],
                                session_id: session_id,
                                text: text,
                            })
                            const filename = filenames[i];
                            count++;
                            console.log("record" + (i + 1) + " inserted");
                            fs.rename('./public/audio/' + filename, './public/completed/' + filename, (err) => {
                                if (err) {
                                    console.log(err);
                                }
                                console.log('Save success');
                            });
                            clearTimeout(timeoutId);
                        } else if (status === 'error') {
                            count++;
                            fs.rename('./public/audio' + filenames[i], './public/error/' + filenames[i], (err) => {
                                if (err) {
                                    console.log(err);
                                }
                                console.log('File is saved in error folder');
                            }, 1000);
                            clearTimeout(timeoutId);
                        }
                    })
                    .catch(err => {
                        console.log(err.message);
                    })
                const timeoutId = setTimeout(countUp, 30000);
            }
            countUp();
        }

    })
});
















app.listen(3000, () => {
    console.log('Server is running on port 3000');
});