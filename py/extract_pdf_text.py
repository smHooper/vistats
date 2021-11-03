import sys, os
import io
import pdfplumber
import pandas as pd


def main(pdf_path):

    with pdfplumber.open(pdf_path) as pdf:
        first_page = pdf.pages[0]
        words = pd.DataFrame(first_page.extract_words())

    def assign_id(group, col_name):
        global ID
        group[col_name] = ID
        ID += 1
        return group

    ID = 0
    words = words.groupby('bottom').apply(lambda g: assign_id(g, 'line_no'))
    first_x = words.groupby('line_no').min().x0
    first_x.name = 'first_x'
    words = words.merge(first_x, left_on='line_no', right_index=True)

    def get_space_after_width(group):
        group['space_after'] = group.x0.shift(-1) - group.x1
        return group
    words = words.groupby('line_no').apply(get_space_after_width)
    words['is_first'] = words.space_before.isnull()
    words.loc[~words.space_after.isna(), 'space_after'] = words.loc[~words.space_after.isna(), 'space_after'].apply(round)

    words.loc[words.space_after == 2, 'join_char'] = ' '
    words.loc[words.space_after > 2, 'join_char'] = ','
    words.loc[words.space_after.isna(), 'join_char'] = '\n'
    n_cols = words.groupby('line_no').apply(lambda g: (g.join_char == ',').sum())
    n_cols.name = 'n_cols'
    words = words.merge(n_cols, left_on='line_no', right_index=True)\
        .loc[words.n_cols > 0]
    data = pd.read_csv(io.StringIO(''.join(words.text + words.join_char)))