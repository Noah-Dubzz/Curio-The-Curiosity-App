require('dotenv').config();
(async function(){
  try{
    const key = process.env.GEMINI_API_KEY;
    console.log('Using key prefix:', key ? key.slice(0,8) : '(none)');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const res = await fetch(url,{method:'GET'});
    console.log('HTTP', res.status);
    const txt = await res.text();
    console.log(txt);
  }catch(e){
    console.error('ERROR', e.message);
    process.exit(1);
  }
})();
