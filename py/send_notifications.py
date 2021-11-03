import sys, os
import json
import smtplib
import traceback
import sqlalchemy
import pandas as pd
import email
import re
from datetime import datetime
from email.mime import text as mimetext, multipart as mimemultipart, base as mimebase


ERRORS = []
LOG_DIR = r'\\inpdenaterm01\vistats\send_notifications_logs'

def write_log():
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')

    log_file_path = os.path.join(LOG_DIR, '{0}_log_{1}.json'.format(os.path.basename(__file__).replace('.py', ''),
                                                                    re.sub('\D', '', timestamp)))

    log_info = {'errors': ERRORS,
                'timestamp': timestamp,
                'log_file_path': log_file_path}

    with open(log_file_path, 'w') as j:
        json.dump(log_info, j, indent=4)

    sys.exit()


def send_email(message_body, subject, sender, recipients, server, attachments=[], message_body_type='plain'):

    msg_root = mimemultipart.MIMEMultipart('mixed')
    msg_root['Date'] = email.utils.formatdate(localtime=True)
    msg_root['From'] = sender
    msg_root['To'] = ', '.join(recipients)
    msg_root['Subject'] = email.header.Header(subject, 'utf-8')

    msg_txt = mimetext.MIMEText(message_body, message_body_type, 'utf-8')
    msg_root.attach(msg_txt)

    for attachment in attachments:
        filename = os.path.basename(attachment)

        with open(attachment, 'rb') as f:
            msg_attach = mimebase.MIMEBase('application', 'octet-stream')
            msg_attach.set_payload(f.read())
            email.encoders.encode_base64(msg_attach)
            msg_attach.add_header('Content-Disposition', 'attachment',
                                  filename=(email.header.Header(filename, 'utf-8').encode()))
            msg_root.attach(msg_attach)

    server.send_message(msg_root)


def send_notifications(param_file, count_date):

    with open(param_file) as f:
        params = json.load(f)

    # parse the php config file
    with open(params['config_php']) as f:
        text = f.read().replace('<?php', '').replace('\n', '').replace('?>', '').replace('\t', '').split(';')
    vars = {k.strip('$ '): v for k, v in dict([var.split('=') for var in text if len(var.split('=')) == 2]).items()}
    user_roles = json.loads(vars['USER_ROLES'].strip("'"))

    try:
        count_datetime = pd.to_datetime(count_date)
    except:
        raise RuntimeError(f'Could not parse {count_date} into a proper datetime')

    season_field = 'is_summer' if count_datetime.month >= 5 and count_datetime.month <= 9 else 'is_winter'

    # Check if the values for the current month are verified for each role
    query_str = f'''
    	SELECT 
			value_labels.id,
			value_labels.dena_label,
			value_labels.retrieve_data_label,
			value_labels.source_tag AS role,
			counts.verified,
			counts.count_date
		FROM
			value_labels LEFT JOIN 
				(
					SELECT * FROM counts INNER JOIN count_periods ON count_periods.id = counts.period_id 
					WHERE 
						extract(year FROM count_periods.count_date) = {count_datetime.year} AND 
						extract(month FROM count_periods.count_date) = {count_datetime.month}
				) AS counts
				ON value_labels.id = counts.value_label_id 
        WHERE 
            (NOT counts.verified OR counts.verified IS NULL) AND
            value_labels.{season_field}
		ORDER BY id;
    '''
    engine = sqlalchemy.create_engine(
        'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['vistats_db_credentials'])
    )
    with engine.connect() as conn:
        data = pd.read_sql(query_str, conn)

    message_template = '''
        <html>
            <head></head>
            <body>
                <p>
                    Hello visitor use stat steward!
                    <br>
                    <br>
                    You are receiving this message because one or more fields for reporting monthly visitor use stats  
                    that you are responsible for entering/verifying has yet to be verified. Please visit 
                    <a href={params[vistats_url]}>{params[vistats_url]}</a> and enter/verify the following fields ASAP:
                </p>
                <ul>
                    {li_elements}
                </ul>
                <p>
                    <br>
                    If you have any questions, you can contact {params[admin_email]}. <strong>This is an automated message, so do not reply directly to it.</strong>
                    <br>
                    Thanks!
                </p>
                <br>
                <p>Here's a <a href="http://taco-randomizer.herokuapp.com/">random taco recipe of the day</a> for your trouble. Enjoy!</p>
            </body>
        </html>
    '''
    try:
        server = smtplib.SMTP(params['mail_server_credentials']['server_name'], params['mail_server_credentials']['port'])
        server.starttls()
        server.ehlo()#'''
    except:
        ERRORS.append({'context': 'connecting to mail server', 'error': traceback.format_exc()})
        write_log()

    month_name = count_datetime.strftime('%B')
    subject = 'Please verify visitor use stats ASAP for {month}, {year}'.format(month=month_name, year=count_datetime.year)

    # For each user, check if any of the fields they're responsible for have yet to be verified
    for user, roles in user_roles.items():
        unverified_fields = data.loc[data.role.isin(roles), 'dena_label']
        if len(unverified_fields):
            # Compose the email
            li_elements = f'''<li>{'</li><li>'.join(unverified_fields)}</li>'''
            message = message_template.format(
                li_elements=li_elements,
                params=params
            )

            recipient = 'shooper@nps.gov'#f'{user}@nps.gov'

            try:
                print(user,'\n',message,'\n\n')
                #send_email(message, subject, params['mail_sender'], [recipient], server,  message_body_type='html')
            except:
                ERRORS.append({'context': f'sending message to {recipient}', 'error': traceback.format_exc()})


def main(param_file, count_date):
    try:
        send_notifications(param_file, count_date)
    except:
        ERRORS.append({'context': 'unexpected', 'error': traceback.format_exc()})
        write_log()

    write_log()


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))

