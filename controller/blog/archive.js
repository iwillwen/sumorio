var async = require('async');
var check = require('validator').check;
var sanitize = require('validator').sanitize;
var mysql = require('../../lib/mysql.js');
var common = require('../common/common.js');
var memssage_ctrl = require('../message.js');
var category_ctrl = require('./category.js');
var user_ctrl = require('../user.js');
var Util = require('../../lib/util.js');
var log = require('../../lib/log.js');


/**
 * 查看某篇文章
 */
exports.view_archive = function(req, res, next) {
    var archive_id = req.params.archive_id;
    var author_id;
    async.auto({
        archive : function(cb) {
            mysql.queryOne("select id,title,content,visit_count,reply_count,author_id,DATE_FORMAT(update_at,'%Y-%m-%d %H:%i:%s') as update_at,DATE_FORMAT(create_at,'%Y-%m-%d %H:%i:%s') as create_at from archive where id = ?", [ archive_id ],
                    function(err, archive) {
                        if (err) {
                            log.error('查找文章时发生异常');
                            cb(null, {});
                        }
                        if (!archive) {
                            res.render('notify/notify', {
                                error : '您查找的文章信息存在错误'
                            });
                            return;
                        }
                        else{
                            author_id = archive.author_id;
                            cb(null, archive);
                        }
                    });
        },
        author : [ 'archive', function(cb) {
            user_ctrl.getUser(author_id, function(err, user) {
                if (err || !user) {
                    cb(null, {});
                }
                cb(null, user);
            });
        } ],
        updateArchive : [ 'archive', function(cb) {
            mysql.update("update archive set visit_count = visit_count + 1 where id = ?", [ archive_id ], function(err, info) {
                if (err) {
                    log.error('更新文章统计信息时发生异常');
                }
                cb(null, null);
            });
        } ],
        archive_categories : function(cb) {
            mysql.query("select * from category where id in (select category_id from archive_category where archive_id=?)", [ archive_id ], function(err, categories) {
                if (err) {
                    cb(null, []);
                }
                if (!categories) {
                    cb(null, []);
                }
                cb(null, categories);
            });
        },
        archive_replies : function(cb) {// 该篇文章的回复
            mysql.query("select * from reply where archive_id = ?", [ archive_id ], function(err, archive_replies) {
                if (err) {
                    cb(null, []);
                }
                if (!archive_replies) {
                    cb(null, []);
                }
                
                //为一级回复查找其author信息及其子回复的相应信息
                async.map(archive_replies, function(reply_item, callback) {    
                        mysql.queryOne('select * from user where id = ?', [ reply_item.author_id ], function(err, user) {
                            if (err) {
                                log.error('查询文章回复的作者信息出错：' + reply_item.author_id);
                            }
                            reply_item.friendly_create_at = Util.format_date(reply_item.create_at, true);
                            reply_item.author = user || {}; 
                            callback(null,reply_item);
                        });    
                    }, 
                    function(err,archive_replies) {
                        cb(null, archive_replies);
                 });
            });
        }
    }, function(err, results) {
        if (err) {
            res.render('notify/notify', {
                error : '您查找的文章信息存在错误'
            });
            return;
        }
        results.archive.replies = results.archive_replies;
        res.render('archive/archive', {
            author : results.author,
            archive : results.archive,
            archive_categories : results.archive_categories
        });
        return;
    });

};

/**
 * 点击编辑文章
 */
exports.edit_archive = function(req, res, next) {
    if (!req.session.user) {
        res.render('notify/notify', {
            error : '未登录用户不能编辑文章'
        });
        return;
    }
    var archive_id = req.params.archive_id;
    var author_id;
    async.auto({
        archive : function(cb) {
            mysql.queryOne("select id,title,content,visit_count,reply_count,author_id,DATE_FORMAT(update_at,'%Y-%m-%d %H:%i:%s') as update_at,DATE_FORMAT(create_at,'%Y-%m-%d %H:%i:%s') as create_at from archive where id = ?", [ archive_id ],
                    function(err, archive) {
                        if (err) {
                            log.error('编辑文章时查找文章信息发生异常');
                            cb(null, {});
                        }
                        if (!archive) {
                            cb(null, {});
                        }
                        else {
                            author_id = archive.author_id;
                            if (author_id != req.session.user.id) {
                                res.render('notify/notify', {
                                    error : '您不具备编辑该文章的权限'
                                });
                                return;
                            }
                            cb(null, archive);
                        }
             });
        },
        all_categories :[ 'archive', function(cb) {
            category_ctrl.get_all_categories(author_id,function(err,categories){
                if(err || !categories){
                    cb(null,[]);
                }
                else{
                    cb(null, categories);
                }
            });
        } ],
        archive_categories : function(cb) {
            mysql.query("select category_id as id from archive_category where archive_id = ?", [ archive_id ], function(err, archive_categories) {
                if (err) {
                    log.error('查找文章的所有所属分类时发生异常');
                    cb(null, []);
                }
                cb(null, archive_categories);
            });
        }
    }, function(err, results) {
        if (err) {
            res.render('notify/notify', {
                error : '您要编辑的文章信息存在错误'
            });
            return;
        }

        for ( var i = 0; results.all_categories.length && i < results.all_categories.length; i++) {
            for ( var j = 0; j < results.archive_categories.length; j++) {
                if (results.archive_categories[j].id == results.all_categories[i].id) {
                    results.all_categories[i].is_selected = true;
                }
            }
        }

        res.render('archive/edit', {
            archive : results.archive,
            categories : results.all_categories
        });
        return;
    });
};

/**
 * 更改文章
 */
exports.modify_archive = function(req, res, next) {
    if (!req.session.user) {
        res.render('notify/notify', {
            error : '未登录用户不能修改文章'
        });
        return;
    }
    var archive_id = req.params.archive_id;
    var title = sanitize(req.body.title).trim();
    title = sanitize(title).xss();
    var content = req.body.content;
    var archive_categories = [];
    if (req.body.archive_categories != '') {
        archive_categories = req.body.archive_categories.split(',');
    }
    var updateDate = Util.format_date(new Date());

    async.auto({
        updateArchive : function(cb) {// 更新文章基本信息
            mysql.update('update archive set title = ?, content = ?, update_at = ? where id = ?', [ title, content, updateDate, archive_id ], function(err, info) {
                if (err) {
                    log.error('更新文章时发生异常');
                    cb(err, '更新文章时发生异常');
                }
                common.get_all_followers(req.session.user.id, function(err, users){//给粉丝发送消息
                    async.forEach(users, function(user, callback) {
                        var mbody = {};
                        mbody.from_user_id = req.session.user.id;
                        mbody.from_user_name = req.session.user.loginname;
                        mbody.archive_id = archive_id;
                        mbody.archive_title = title;
                        memssage_ctrl.create_message(common.MessageType.update_archive, user.id, JSON.stringify(mbody), function(){
                            callback();
                        });
                    }, function(err) {
                        cb(null, '');
                    });
                });      
            });
        },
        deleteArchiveCategories : [ 'updateArchive', function(cb) {// 删除旧的文章分类
            mysql.insert('delete from archive_category where archive_id = ?', [ archive_id ], function(err, info) {
                if (err) {
                    log.error('删除文章旧分类发生异常');
                    cb(err, '删除文章旧分类发生异常');
                }
                cb(null, '');
            });
        } ],
        updateArchiveCategories : [ 'deleteArchiveCategories', function(cb) {// 插入新的文章分类
            
            async.forEach(archive_categories, function(category_item, callback) {
                mysql.insert('insert into archive_category(archive_id, category_id) values(?,?)', [ archive_id, category_item ], function(err, info) {
                    if (err) {
                        log.error('修改文章：插入新的文章分类出现错误[' + archive_id + ',' + category_item + ']');
                    }
                    callback(null, null);
                });
            }, function(err) {
                cb(null, '');
            });
        }],
    }, function(err, results) {
        if (err) {
            res.render('notify/notify', {
                error : '修改文章时发生错误'
            });
            return;
        }
        res.redirect('/archive/' + archive_id);
    });

};

/**
 * 删除文章
 * 
 * @param req
 * @param res
 * @param next
 */
exports.delete_archive = function(req, res, next) {
    if (!req.session.user) {
        res.render('notify/notify', {
            error : '未登录用户不能删除文章'
        });
        return;
    }
    mysql.update('delete from archive where id = ? and author_id = ?', [ req.params.archive_id, req.session.user.id ], function(err, info) {
        if (err) {
            log.error('删除文章出错:' + info);
            res.render('notify/notify', {
                error : '删除文章出错,请检查您是否为该文章作者或者操作是否出错'
            });
            return;
        }
        mysql.update('delete from archive_category where archive_id = ?', [ req.params.archive_id ], function(err, info) {
            if (err) {
                log.error('删除文章[删除分类]出错:' + info);
                res.render('notify/notify', {
                    error : '从文章分类中删除这篇文章出错'
                });
                return;
            }
            
            mysql.update('delete from reply where archive_id = ?', [ req.params.archive_id ], function(err, info) {
                if (err) {
                    log.error('删除文章[删除回复]出错:' + info);
                    res.render('notify/notify', {
                        error : '删除这篇文章的回复出错'
                    });
                    return;
                }

                res.render('notify/notify', {
                    success : '删除文章成功'
                });
                return;
            });
            
        });
    });
};

/**
 * 查看用户的文章[不按分类]
 * 
 * @param req
 * @param res
 * @param next
 */
exports.view_user_archives = function(req, res, next) {
    var user_id = req.params.user_id;
    
    mysql.query('select  id,title,content,visit_count,reply_count,author_id,DATE_FORMAT(update_at,"%Y-%m-%d %H:%i:%s") as update_at,DATE_FORMAT(create_at,"%Y-%m-%d %H:%i:%s") as create_at  from archive where author_id = ? order by update_at desc', [ user_id ], function(err, archives) {
        if (err) {
            res.render('notify/notify', {
                error : '查找用户的所有文章出错'
            });
            return;
        }

        res.render('archive/user_archives', {
            user_id : user_id,
            archives : archives
        });
        return;
       
    });
};


/**
 * 查看用户某分类下文章
 * 
 * @param req
 * @param res
 * @param next
 */
exports.view_archives = function(req, res, next) {
    var category_id = req.params.category_id;
    var user_id = req.params.user_id;
    
    mysql.query('select  id,title,content,visit_count,reply_count,author_id,DATE_FORMAT(update_at,"%Y-%m-%d %H:%i:%s") as update_at,DATE_FORMAT(create_at,"%Y-%m-%d %H:%i:%s") as create_at  from archive where author_id = ? and id in (select archive_id from archive_category where category_id = ?) order by update_at desc', [ user_id, category_id ], function(err, archives) {
        if (err) {
            res.render('notify/notify', {
                error : '查找分类下文章出错'
            });
            return;
        }
        else{
            category_ctrl.get_category(category_id, function(err, category){
                res.render('archive/archives', {
                    user_id : user_id,
                    archives : archives,
                    category : category || {}
                });
            }); 
        }
        
    });
};

/**
 * 发布新文章
 * 
 * @param req
 * @param res
 * @param next
 */
exports.create_archive = function(req, res, next) {
    if (!req.session.user) {
        res.render('notify/notify', {
            error : '未登录用户不能发布文章'
        });
        return;
    }

    var method = req.method.toLowerCase();

    if (method == 'get') {// 点击"发布"按钮
        category_ctrl.get_all_categories(req.session.user.id, function(err, categories) {
            if (err) {
                res.render('notify/notify', {error : '获取所有分类出错'});
                return;
            }
            res.render('archive/create', {
                categories : categories
            });
            return;

        });
    }

    if (method == 'post') {
        var title = sanitize(req.body.title).trim();
        title = sanitize(title).xss();
        var content = req.body.content;// 要配置editor_config.js的textarea才会生效
        var archive_categories = [];
        if (req.body.archive_categories != '') {
            archive_categories = req.body.archive_categories.split(',');
        }
        
        var insertDate = Util.format_date(new Date());
        mysql.insert('insert into archive(title,content,author_id,create_at,update_at) values(?,?,?,?,?)', [ title, content, req.session.user.id, insertDate, insertDate ], function(err, info) {
            if (err) {
                res.render('notify/notify', {
                    error : '保存文章时发生错误'
                });
                return;
            }

            async.forEach(archive_categories, function(category_item, callback) {
                mysql.insert('insert into archive_category(archive_id, category_id) values(?,?)', [ info.insertId, category_item ], function(err, info) {
                    callback();
                });
            }, function(err) {
                if (err) {
                    res.render('notify/notify', {error : '保存文章分类时发生错误'});
                    return;
                }
                else{
                    common.get_all_followers(req.session.user.id, function(err, users){//给粉丝发送消息
                        async.forEach(users, function(user, callback) {
                            var mbody = {};
                            mbody.from_user_id = req.session.user.id;
                            mbody.from_user_name = req.session.user.loginname;
                            mbody.archive_id = info.insertId;
                            mbody.archive_title = title;
                            memssage_ctrl.create_message(common.MessageType.create_archive, user.id, JSON.stringify(mbody), function(){
                                callback();
                            });
                        }, function(err) {
                            res.redirect('/archive/' + info.insertId);
                        });
                    });               
                }
            });
        });

    }
};
