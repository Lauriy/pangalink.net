'use strict';

module.exports = function(grunt) {

    // Project configuration.
    grunt.initConfig({
        jshint: {
            all: ['lib/*.js', 'index.js', 'Gruntfile.js', 'server.js'],
            options: {
                jshintrc: '.jshintrc'
            }
        },

        jsxgettext: {
            sources: {
                files: [{
                    src: ['./www/views/**/*.ejs', './lib/**/*.js', 'server.js', 'index.js'],
                    dest: './i18n/messages.pot'
                }],
                options: {
                    keyword: ['gettext']
                }
            }
        },

        shell: { // Task
            messages: { // Target
                options: { // Options
                    stderr: false
                },
                command: './bin/merge-po.sh'
            },
            po2json: {
                options: { // Options
                    stderr: false
                },
                command: './bin/po2json.sh'
            }
        }

    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jsxgettext');
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-po2json-simple');

    // Tasks
    grunt.registerTask('default', ['jshint', 'jsxgettext', 'shell']);
};