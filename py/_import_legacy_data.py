import os
import sys
import pandas as pd

EXCEL_PATH = r"C:\Users\shooper\local_working\vistats_local\from_rose\DENA_Monthly_Data_for_MPUR.xlsx"

pd.set_option('display.max_columns', None)

def main():

    for year in range(2014, 2020):
        # Can't do this by position or exact label because both change, so I'll have to develop of dict of all possible values to map to my cols
        df = pd.read_excel(EXCEL_PATH, sheet_name=str(year))