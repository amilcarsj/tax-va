from flask import Flask, render_template
import os
from controllers.dataset_controller import dataset_bp

app = Flask(
    __name__,
    template_folder=os.path.join('views', 'templates'),
    static_folder='static',
)
app.register_blueprint(dataset_bp)


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, port=8000)
