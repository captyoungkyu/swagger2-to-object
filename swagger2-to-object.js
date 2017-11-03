// Ported from https://github.com/swagger-api/swagger-ui (Apache License, Version 2.0)
//     see: https://github.com/swagger-api/swagger-ui/blob/master/src/core/plugins/samples/fn.js
//        & https://github.com/swagger-api/swagger-ui/blob/master/src/core/utils.js
//
// TODO: fix missing immutable import (currently just returns false for isImmutable)

//Im = require("immutable")

const stringCollection = {
    ref: "#/definitions/Collection«string»",
    schema: {
        "type": "array",
        "items": {
            "type": "string"
        }
    }
}

const primitives = {
    "string": () => "string",
    "string_email": () => "user@example.com",
    "string_date-time": () => new Date().toISOString(),
    "number": () => 0,
    "number_float": () => 0.0,
    "integer": () => 0,
    "boolean": (schema) => typeof schema.default === "boolean" ? schema.default : true
}

const primitive = (schema) => {
    schema = objectify(schema);
    let { type, format } = schema;

    let fn = primitives[`${type}_${format}`] || primitives[type];

    if (isFunc(fn)) {
        return fn(schema);
    }

    return `Unknown Type: ${schema.type}`;
}

const isFunc = (thing) => typeof (thing) === "function"

const isImmutable = (maybe) => false //Im.Iterable.isIterable(maybe)

const isObject = (obj) => !!obj && typeof obj === "object"

const getRef = (obj) => isObject(obj) ? obj["$ref"] : undefined

const isRef = (obj) => getRef(obj)

const normalizeArray = (arr) => Array.isArray(arr) ? arr : [arr];

function objectify(thing) {
    if (!isObject(thing)) {
        return {};
    }

    if (isImmutable(thing)) {
        return thing.toObject();
    }

    return thing;
}

function resolveRef(refObj, refsLookup) {
    var ref = getRef(refObj);

    if (ref === stringCollection.ref) {
        return stringCollection.schema;
    } else {
        var schema = refsLookup[ref];
        return schema;
    }
}

function genSchemaObject(schema, refsLookup, config = {}) {
    if (isRef(schema)) {
        schema = resolveRef(schema, refsLookup);
    }

    let { type, example, properties, additionalProperties, items } = objectify(schema);
    let { includeReadOnly, includeWriteOnly } = config;

    if (example !== undefined) {
        return example;
    }

    if (!type) {
        if (properties) {
            type = "object";
        } else if (items) {
            type = "array";
        } else {
            return;
        }
    }

    if (type === "object") {
        let props = objectify(properties);
        let obj = {};

        for (var name in props) {
            if (props[name].readOnly && !includeReadOnly) {
                continue;
            }

            if (props[name].writeOnly && !includeWriteOnly) {
                continue;
            }

            if (isRef(props[name])) {
                props[name] = resolveRef(props[name], refsLookup);
            }

            obj[name] = genSchemaObject(props[name], refsLookup, config);
        }

        if (additionalProperties === true) {
            obj.additionalProp1 = {};
        } else if (additionalProperties) {
            let additionalProps = objectify(additionalProperties);
            let additionalPropVal = genSchemaObject(additionalProps, refsLookup, config);

            for (let i = 1; i < 4; i++) {
                obj[`additionalProp${i}`] = additionalPropVal;
            }
        }
        return obj;
    }

    if (type === "array") {
        if (isRef(items)) {
            items = resolveRef(items, refsLookup);
        }

        return [genSchemaObject(items, refsLookup, config)];
    }

    if (schema["enum"]) {
        schema["default"] ? schema["default"] : normalizeArray(schema["enum"])[0];
    }

    if (type === "file") {
        return;
    }

    return primitive(schema);
}

function getRefForSchema (schema, unknownTypeCounter) {
    if (schema.$ref) {
        return schema.$ref;
    } else if (isObject(schema.items) && schema.items.$ref) {
        return schema.items.$ref;
    } else {
        return `unknown_type_${unknownTypeCounter}`;
    }
}

function genSpecResponseObjects (swaggerSpec, options) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec);
    var specResponses = {};
    var unknownTypeCounter = 0;
    var includeUnknownTypes = options && options.includeUnknownTypes;

    var paths = swaggerSpec.paths;

    for (var key in paths) {
        if (!paths.hasOwnProperty(key)) {
            continue;
        }

        var pathRoot = paths[key];

        for (var pathKey in pathRoot) {
            if (!pathRoot.hasOwnProperty(pathKey)) {
                continue;
            }

            var responses = pathRoot[pathKey].responses;

            if (!responses) {
                continue;
            }

            for (var responseKey in responses) {
                if (!responses.hasOwnProperty(responseKey)) {
                    continue;
                }
            
                var response = responses[responseKey];
                var schema = response.schema;

                if (!schema) {
                    continue;
                }

                var obj = genSchemaObject(response.schema, refsLookup);
                var ref = getRefForSchema(schema, unknownTypeCounter);
                
                if (!specResponses[ref]) {
                    if (ref.includes("unknown_type_")) {
                        unknownTypeCounter++;

                        if (!includeUnknownTypes) {
                            continue;
                        }
                    }

                    specResponses[ref] = obj;
                }
            }
        }
    }

    return specResponses;
}

function genSpecRequestObjects (swaggerSpec, options) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec);
    var specRequests = {};
    var unknownTypeCounter = 0;
    var includeUnknownTypes = options && options.includeUnknownTypes;

    var paths = swaggerSpec.paths;

    for (var key in paths) {
        if (!paths.hasOwnProperty(key)) {
            continue;
        }

        var pathRoot = paths[key];

        for (var pathKey in pathRoot) {
            if (!pathRoot.hasOwnProperty(pathKey)) {
                continue;
            }

            var path = pathRoot[pathKey];
            let {parameter, obj} = genObjectForPathBody(path, refsLookup);

            if (!obj) {
                continue;
            }

            var schema = parameter.schema;
            var ref = getRefForSchema(schema, unknownTypeCounter);

            if (!specRequests[ref]) {
                if (ref.includes("unknown_type_")) {
                    unknownTypeCounter++;
                    
                    if (!includeUnknownTypes) {
                        continue;
                    }
                }

                specRequests[ref] = obj;
            }
        }
    }

    return specRequests;
}

function genSpecSchemaObjects (swaggerSpec) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec);
    var specObjs = {};

    for (var key in refsLookup) {
        if (!refsLookup.hasOwnProperty(key)) {
            continue;
        }

        specObjs[key] = genSchemaObject(refsLookup[key], refsLookup);
    }

    return specObjs;
}

function genObjectForPathBody (swaggerPath, swaggerRefsLookup) {
    var result = {
        parameter: undefined,
        obj: undefined
    };

    if (!swaggerPath.parameters || 
        (swaggerPath.parameters.length < 1)) {
            return result;
    }

    swaggerPath.parameters.forEach((p) => {
        if (result.obj || !p.in || p.in !== "body") {
            return;
        }

        try {
            result.obj = genSchemaObject(p.schema, swaggerRefsLookup);
            result.parameter = p;
        } catch (e) {
            sampleObj = undefined;
            console.log(`Error generating sample from schema: ${JSON.stringify(p.schema)}`);
            console.log(e);
        }
    });

    return result;
}

function buildSwaggerRefsLookup(swaggerSpec) {
    var refsLookup = {};
    var refCount = 0;

    console.log(`Building refs lookup for Swagger spec '${swaggerSpec.info.title}'...`)

    for (var key in swaggerSpec.definitions) {
        if (swaggerSpec.definitions.hasOwnProperty(key)) {
            ref = `#/definitions/${key}`;
            schema = swaggerSpec.definitions[key];

            console.log(`Schmea for ref '${ref}': `);
            console.log(`${JSON.stringify(schema, null, 4)}`);

            refsLookup[ref] = schema;
            refCount++;
        }
    }

    if (refCount > 0) {
        console.log(`Found ${refCount} schema definitions in Swagger spec`)
    } else {
        console.log(`Swagger spec contained no schema definitions`)
    }

    return refsLookup;
}

module.exports = {
    buildRefsLookup: () => ({
        forSpec: buildSwaggerRefsLookup
    }),
    generateObjects: () => ({
        for: () => ({
            specSchemas: (spec) => genSpecSchemaObjects(spec),
            specRequests: (spec, options) => genSpecRequestObjects(spec, options),
            specResponses: (spec, options) => genSpecResponseObjects(spec, options)
        })
    }),
    generateObject: () => ({
        for: () => ({
            pathBodyUsingRefs: (path, refs) => (genObjectForPathBody(path, refs)).obj,
            schemaUsingRefs: genSchemaObject,
            schemaUsingSpec: (schema, spec) =>
                genSchemaObject(schema, buildSwaggerRefsLookup(spec))
        })
    })
}