import PostalMime from 'postal-mime';
import {receiveEmail} from './handler.mjs';
export default {
  async email(message,env){
    const result=await receiveEmail(message,env,{parse:raw=>PostalMime.parse(raw)});
    // Only operational metadata; never log addresses, subjects, bodies or secrets.
    if(!result.stored)console.warn('domain_mail_not_stored');
  },
};
