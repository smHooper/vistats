import sys
from datetime import datetime
from dateutil import relativedelta

import retrieve_data
import send_notifications


RETRIEVE_DATA_PARAMS = r"\\inpdenaterm01\vistats\config\retrieve_data_params.json"
SEND_NOTIFICATIONS_PARAMS = r"\\inpdenaterm01\vistats\config\send_notifications_params.json"


def main():

    now = datetime.now()

    if now.day == 5:
        retrieve_data.main(RETRIEVE_DATA_PARAMS)

    if now.day == 7:
        count_datetime = (now - relativedelta.relativedelta(months=1)).replace(day=1)
        send_notifications.main(SEND_NOTIFICATIONS_PARAMS, count_datetime.strftime('%Y-%m-%d'))


if __name__ == '__main__':
    sys.exit(main())